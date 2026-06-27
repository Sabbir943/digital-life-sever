const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose');

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;
const uri = process.env.MONGODB_URI;

// --- ১. গলোবাল মিডলওয়্যার কনফিগারেশন ---
app.use(cors({
    origin: 'http://localhost:3000', // আপনার ফ্রন্টএন্ড ইউআরএল
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
}));
app.use(express.json());

// --- ২. Better-Auth JWKS এবং টোকেন ভেরিফিকেশন মিডলওয়্যার সেটআপ ---
// প্রথম কন্ডিশন: এই মিডলওয়্যারটি সমস্ত প্রোটেক্টেড রাউটের টোকেন ভেরিফাই করবে।
const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Unauthorized: Token missing" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ success: false, message: "Unauthorized: Invalid token format" });
    }

    try {
        const { payload } = await jwtVerify(token, JWKS);
        
        // Better-Auth এর পে-লোড থেকে ইউজার অবজেক্ট রিকোয়েস্টে সেট করা
        req.user = payload.user ? payload.user : payload;

        next(); // টোকেন ভ্যালিড হলে পরের কোড বা রাউটে চলে যাবে
    } catch (error) {
        console.error("Token Verification Error:", error);
        return res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token" });
    }
};

// অ্যাডমিন ভেরিফিকেশন মিডলওয়্যার
// const verifyAdmin = (req, res, next) => {
//     if (req.user && req.user.role === 'admin') {
//         next();
//     } else {
//         return res.status(403).json({ success: false, message: "Forbidden: Admin access required" });
//     }
// };

// --- ৩. মঙ্গোডিবি ক্লায়েন্ট সেটআপ ---
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();
        
        const db = client.db("digital-lessons");
        const lessonsCollection = db.collection("lessions-add");
        const usersCollection = db.collection("user"); 
        const commentsCollection = db.collection("comments");
        const reportsCollection = db.collection("lessonsReports");
        const subscriptionCollection = db.collection('subscriptionData');
        console.log("🔒 Successfully connected to MongoDB Atlas!");

        // ========================================================
        // 🏠 [ADMIN DASHBOARD ROUTES] - Protected by Token & Admin Role
        // ========================================================
        
        app.get("/api/admin/overview-stats", verifyToken,  async (req, res) => {
            try {
                const totalUsers = await usersCollection.countDocuments();
                const totalPublicLessons = await lessonsCollection.countDocuments({ visibility: "Public" });
                const totalReportedLessons = await reportsCollection.countDocuments();
                
                const todayStart = new Date();
                todayStart.setHours(0,0,0,0);
                const todaysLessons = await lessonsCollection.countDocuments({
                    createdAt: { $gte: todayStart.toISOString() }
                });

                const topContributors = await lessonsCollection.aggregate([
                    { $group: { _id: "$creatorEmail", lessonsCount: { $sum: 1 }, name: { $first: "$creatorName" }, image: { $first: "$creatorImage" } } },
                    { $sort: { lessonsCount: -1 } },
                    { $limit: 5 },
                    { $project: { email: "$_id", _id: 0, name: { $ifNull: ["$name", "$email"] }, image: 1, lessonsCount: 1 } }
                ]).toArray();

                const recentSubmissions = await lessonsCollection.find({}, { projection: { _id: 1 } })
                    .sort({ createdAt: -1 }).limit(12).toArray();
                const growthTrends = recentSubmissions.map((_, i) => ({ count: i + 1 }));

                res.json({
                    stats: { totalUsers, totalPublicLessons, totalReportedLessons, todaysLessons },
                    topContributors,
                    growthTrends
                });
            } catch (error) {
                res.status(500).json({ message: "Failed to load dashboard metrics" });
            }
        });

        app.get("/api/admin/users", verifyToken,  async (req, res) => {
            try {
                const { search } = req.query;
                let query = {};
                if (search) {
                    query = {
                        $or: [
                            { name: { $regex: search, $options: 'i' } },
                            { email: { $regex: search, $options: 'i' } }
                        ]
                    };
                }
                const users = await usersCollection.find(query).toArray();
                res.json({ users });
            } catch (error) {
                res.status(500).json({ message: "Failed to fetch users" });
            }
        });

        app.patch("/api/admin/users/:id/promote", verifyToken,  async (req, res) => {
            try {
                const id = req.params.id;
                const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
                const result = await usersCollection.updateOne(query, { $set: { role: 'admin' } });
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Promotion failed" });
            }
        });

        app.delete("/api/admin/users/:id", verifyToken,  async (req, res) => {
            try {
                const id = req.params.id;
                const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
                const result = await usersCollection.deleteOne(query);
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Failed to delete user" });
            }
        });

        app.get("/api/admin/lessons", verifyToken,  async (req, res) => {
            try {
                const { category } = req.query;
                let query = {};
                if (category && category !== 'All') {
                    query.category = category;
                }
                const lessons = await lessonsCollection.find(query).sort({ createdAt: -1 }).toArray();
                const publicCount = await lessonsCollection.countDocuments({ visibility: "Public" });
                const privateCount = await lessonsCollection.countDocuments({ visibility: "Private" });
                const flaggedCount = await reportsCollection.countDocuments();

                res.json({
                    lessons,
                    counts: { public: publicCount, private: privateCount, flagged: flaggedCount }
                });
            } catch (error) {
                res.status(500).json({ message: "Failed to fetch dashboard lessons" });
            }
        });

        app.patch("/api/admin/lessons/:id/feature", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const { isFeatured } = req.body;
                const result = await lessonsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isFeatured: isFeatured } }
                );
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Failed to update feature status" });
            }
        });

        app.patch("/api/admin/lessons/:id/review", verifyToken,  async (req, res) => {
            try {
                const id = req.params.id;
                const result = await lessonsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isReviewed: true } }
                );
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Failed to review content" });
            }
        });

        app.get("/api/admin/reports", verifyToken,  async (req, res) => {
            try {
                const reportedLessons = await reportsCollection.aggregate([
                    { $group: { _id: "$lessonId", title: { $first: "$lessonTitle" }, reports: { $push: { reporterEmail: "$reporterEmail", reason: "$reason" } } } },
                    { $project: { _id: 1, title: { $ifNull: ["$title", "Untitled Reported Lesson"] }, reports: 1 } }
                ]).toArray();
                res.json({ reportedLessons });
            } catch (error) {
                res.status(500).json({ message: "Failed to fetch flag logs" });
            }
        });

        app.delete("/api/admin/reports/:lessonId/ignore", verifyToken,  async (req, res) => {
            try {
                const lessonId = req.params.lessonId;
                const result = await reportsCollection.deleteMany({ lessonId: lessonId });
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Failed to clear reports" });
            }
        });

        app.get("/api/admin/profile-activity", verifyToken,  async (req, res) => {
            try {
                const reviewedCount = await lessonsCollection.countDocuments({ isReviewed: true });
                const flagsHandled = await lessonsCollection.countDocuments({ isFeatured: true });
                res.json({ activitySummary: { reviewed: reviewedCount, flagsHandled } });
            } catch (error) {
                res.status(500).json({ message: "Failed to fetch profile logs" });
            }
        });

        // ========================================================
        // 📖 [USER PROTECTED ROUTES] - Token Verification Only
        // ========================================================

        // নতুন লেসন তৈরি করা (অবশ্যই লগইন করা থাকতে হবে)
        app.post("/api/lessons", verifyToken, async (req, res) => {
            try {
                const body = req.body;
                const addlessons = {
                    ...body,
                    creatorEmail: req.user.email, // টোকেন থেকে ইমেইল অ্যাসাইন করা হলো সিকিউরিটির জন্য
                    likes: [],
                    likesCount: 0,
                    favoritesCount: 0,
                    createdAt: new Date().toISOString()
                };
                const result = await lessonsCollection.insertOne(addlessons);
                res.status(201).json(result);
            } catch (error) {
                res.status(500).json({ success: false, message: "Database insertion failed" });
            }
        });

        // লাইক টগল রাউট
        app.patch("/api/lessons/:id/like", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const email = req.user.email; // টোকেন থেকে সরাসরি ইমেইল নেওয়া হচ্ছে

                if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid data" });

                const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
                if (!lesson) return res.status(404).json({ message: "Lesson not found" });

                const hasLiked = lesson.likes && lesson.likes.includes(email);
                const updateDoc = hasLiked 
                    ? { $pull: { likes: email }, $inc: { likesCount: -1 } }
                    : { $addToSet: { likes: email }, $inc: { likesCount: 1 } };

                const result = await lessonsCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Like action failed" });
            }
        });

        // নতুন কমেন্ট পোস্ট
        app.post("/api/lessons/:id/comments", verifyToken, async (req, res) => {
            try {
                const commentDoc = {
                    ...req.body,
                    reporterEmail: req.user.email, // টোকেন থেকে ব্যবহারকারী নিশ্চিত করা
                    createdAt: new Date()
                };
                const result = await commentsCollection.insertOne(commentDoc);
                res.status(201).json(result);
            } catch (error) {
                res.status(500).json({ message: "Comment submission failed" });
            }
        });

        // রিপোর্ট সিস্টেম
        app.post("/api/reports", verifyToken, async (req, res) => {
            try {
                const reportData = {
                    ...req.body,
                    reporterEmail: req.user.email
                };
                const result = await reportsCollection.insertOne(reportData);
                res.status(201).json(result);
            } catch (error) {
                res.status(500).json({ message: "Reporting failed" });
            }
        });

        // সাবস্ক্রিপশন রাউট (Pro Plan এ আপগ্রেড)
        app.post('/subscription',  async (req, res) => {
            try {
                const { sessionId, userId, userEmail } = req.body;

                const existing = await subscriptionCollection.findOne({ sessionId });
                if (existing) {
                    return res.status(400).json({ success: false, message: "Already subscribed" });
                }

                const result = await subscriptionCollection.insertOne({
                    sessionId, userId, userEmail, createdAt: new Date()
                });
                
                await usersCollection.updateOne(
                    { email: req.user.email }, // Better security: update via verified token email
                    { $set: { userPlan: "Pro" } }
                );

                res.status(200).json({ success: true, msg: "Payment successfully!!!" });
            } catch (error) {
                res.status(500).json({ success: false, message: "Internal server error" });
            }
        });

        // ফেভারিট টগল রাউট
        app.post("/api/lessons/:id/favorite", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const email = req.user.email; 
                const { toggle } = req.body; 

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ message: "Invalid lesson ID" });
                }

                let updateDoc = toggle 
                    ? { $addToSet: { favoritedBy: email }, $inc: { favoritesCount: 1 } }
                    : { $pull: { favoritedBy: email }, $inc: { favoritesCount: -1 } };

                const result = await lessonsCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ message: "Favorite action failed" });
            }
        });

        // ইউজারের নিজস্ব ফেভারিট লিস্ট গেট রাউট
        app.get("/api/users/favorites", verifyToken, async (req, res) => {
            try {
                const email = req.user.email; // টোকেন থেকে সেফলি ইমেইল নেওয়া হচ্ছে
                const query = { favoritedBy: email };
                const result = await lessonsCollection.find(query).sort({ createdAt: -1 }).toArray();
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Failed to fetch favorites" });
            }
        });

        // ========================================================
        // 🌍 [PUBLIC ROUTES] - No Token Needed
        // ========================================================
        
        app.get("/api/public-lessons", async (req, res) => {
            try {
                const { search, category, tone, sort, page = 1, limit = 6 } = req.query;
                let query = { visibility: "Public" };

                if (search) {
                    query.$or = [
                        { title: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } }
                    ];
                }
                if (category && category !== 'All') query.category = category;
                if (tone && tone !== 'All') query.emotionalTone = tone;

                let sortOptions = { createdAt: -1 };
                if (sort === 'oldest') sortOptions = { createdAt: 1 };
                else if (sort === 'most-saved') sortOptions = { favoritesCount: -1 };
                else if (sort === 'most-liked') sortOptions = { likesCount: -1 };

                const pageNum = parseInt(page);
                const limitNum = parseInt(limit);
                const skip = (pageNum - 1) * limitNum;

                const totalLessons = await lessonsCollection.countDocuments(query);
                const totalPages = Math.ceil(totalLessons / limitNum);

                const result = await lessonsCollection.find(query).sort(sortOptions).skip(skip).limit(limitNum).toArray();

                res.json({ lessons: result, pagination: { totalLessons, totalPages, currentPage: pageNum, limit: limitNum } });
            } catch (error) {
                res.status(500).json({ success: false, message: "Failed to fetch public lessons" });
            }
        });

        app.get("/api/lessons/:id", async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid Object ID" });
                const result = await lessonsCollection.findOne({ _id: new ObjectId(id) });
                if (!result) return res.status(404).json({ message: "Lesson not found" });
                res.json(result);
            } catch (error) {
                res.status(500).json({ success: false, message: "Server Error" });
            }
        });

        app.get("/api/lessons/:id/comments", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await commentsCollection.find({ lessonId: id }).sort({ createdAt: -1 }).toArray();
                res.json(result);
            } catch (error) {
                res.status(500).json({ message: "Failed to fetch comments" });
            }
        });

    } catch (error) {
        console.error("Database connection error:", error);
    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Digital Life Lessons Backend is Running! 🚀')
});

app.listen(port, () => {
    console.log(`📡 Server is blazing fast on port ${port}`)
});