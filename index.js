const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;
const uri = process.env.MONGODB_URI;

// --- ১. গ্লোবাল মিডলওয়্যার কনফিগারেশন (সবার উপরে ফিক্সড) ---
app.use(cors({
    origin: 'http://localhost:3000', // আপনার ফ্রন্টএন্ড ইউআরএল
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
}));
app.use(express.json()); // 🟢 এটাকে গ্লোবালি এখানে নিয়ে আসা হলো যাতে সব রাউট req.body পায়।

// --- ২. মঙ্গোডিবি ক্লায়েন্ট সেটআপ ---
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
    // 🏠 [ADMIN DASHBOARD ROUTE 1] - Overview Stats & Trends
    // ========================================================
    app.get("/api/admin/overview-stats", async (req, res) => {
        try {
            const totalUsers = await usersCollection.countDocuments();
            const totalPublicLessons = await lessonsCollection.countDocuments({ visibility: "Public" });
            const totalReportedLessons = await reportsCollection.countDocuments();
            
            // আজকের নতুন লেসন কাউন্ট
            const todayStart = new Date();
            todayStart.setHours(0,0,0,0);
            const todaysLessons = await lessonsCollection.countDocuments({
                createdAt: { $gte: todayStart.toISOString() }
            });

            // মোস্ট অ্যাক্টিভ কন্ট্রিবিউটর (Top 5)
            const topContributors = await lessonsCollection.aggregate([
                { $group: { _id: "$creatorEmail", lessonsCount: { $sum: 1 }, name: { $first: "$creatorName" }, image: { $first: "$creatorImage" } } },
                { $sort: { lessonsCount: -1 } },
                { $limit: 5 },
                { $project: { email: "$_id", _id: 0, name: { $ifNull: ["$name", "$email"] }, image: 1, lessonsCount: 1 } }
            ]).toArray();

            // গ্রাফ ট্রেন্ড ডাটা (শেষ ১২টি লেসন এর সহজ গ্রাফিক্যাল রিপ্রেজেন্টেশন)
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

    // ========================================================
    // 👥 [ADMIN DASHBOARD ROUTE 2] - User Management
    // ========================================================
    app.get("/api/admin/users", async (req, res) => {
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

    // ইউজার প্রমোট রাউট (PATCH)
    app.patch("/api/admin/users/:id/promote", async (req, res) => {
        try {
            const id = req.params.id;
            const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
            const result = await usersCollection.updateOne(query, { $set: { role: 'admin' } });
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: "Promotion failed" });
        }
    });

    // ইউজার ডিলিট রাউট (DELETE)
    app.delete("/api/admin/users/:id", async (req, res) => {
        try {
            const id = req.params.id;
            const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
            const result = await usersCollection.deleteOne(query);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: "Failed to delete user" });
        }
    });

    // ========================================================
    // 📖 [ADMIN DASHBOARD ROUTE 3] - Lesson Management
    // ========================================================
    app.get("/api/admin/lessons", async (req, res) => {
        try {
            const { category } = req.query;
            let query = {};
            if (category && category !== 'All') {
                query.category = category;
            }

            const lessons = await lessonsCollection.find(query).sort({ createdAt: -1 }).toArray();
            
            // মডারেটর কাউন্ট কার্ডের ডাটা সমুহ
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

    // লেসন ফিচারড টগল রাউট (PATCH)
    app.patch("/api/admin/lessons/:id/feature", async (req, res) => {
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

    // কনটেন্ট রিভিউড মার্ক করার রাউট (PATCH)
    app.patch("/api/admin/lessons/:id/review", async (req, res) => {
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

    // ========================================================
    // 🚨 [ADMIN DASHBOARD ROUTE 4] - Reported System
    // ========================================================
    app.get("/api/admin/reports", async (req, res) => {
        try {
            // রিপোর্ট কালেকশন থেকে ইউনিক লেসন আইডি অনুযায়ী গ্রুপ করে রিপোর্টের ডিটেইলস নিয়ে আসা
            const reportedLessons = await reportsCollection.aggregate([
                {
                    $group: {
                        _id: "$lessonId",
                        title: { $first: "$lessonTitle" },
                        reports: { $push: { reporterEmail: "$reporterEmail", reason: "$reason" } }
                    }
                },
                {
                    $project: {
                        _id: 1,
                        title: { $ifNull: ["$title", "Untitled Reported Lesson"] },
                        reports: 1
                    }
                }
            ]).toArray();

            res.json({ reportedLessons });
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch flag logs" });
        }
    });

    // রিপোর্ট ইগনোর/ক্লিয়ার করার রাউট (DELETE reports by lessonId)
    app.delete("/api/admin/reports/:lessonId/ignore", async (req, res) => {
        try {
            const lessonId = req.params.lessonId;
            const result = await reportsCollection.deleteMany({ lessonId: lessonId });
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: "Failed to clear reports" });
        }
    });

    // ========================================================
    // 👤 [ADMIN DASHBOARD ROUTE 5] - Profile Log Data
    // ========================================================
    app.get("/api/admin/profile-activity", async (req, res) => {
        try {
            const reviewedCount = await lessonsCollection.countDocuments({ isReviewed: true });
            const flagsHandled = await lessonsCollection.countDocuments({ isFeatured: true }); // অথবা আপনার মডারেশন ট্র্যাক লজিক
            res.json({
                activitySummary: { reviewed: reviewedCount, flagsHandled }
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch profile logs" });
        }
    });

   app.post("/api/lessons", async (req, res) => {
        try {
            const body = req.body;
            const addlessons = {
                ...body,
                likes: [],
                likesCount: 0,
                favoritesCount: 0,
                createdAt: new Date().toISOString()
            };
            const result = await lessonsCollection.insertOne(addlessons);
            res.status(201).json(result);
        } catch (error) {
            console.error("Insert Error:", error);
            res.status(500).json({ success: false, message: "Database insertion failed" });
        }
    });

    // পাবলিক লেসন ব্রাউজ করার রুট (GET - Browse Public Lessons Page)
   // পাবলিক লেসন ব্রাউজ করার রুট (GET - Browse Public Lessons Page with Search, Filter, Sort, Pagination)
    app.get("/api/public-lessons", async (req, res) => {
        try {
            const { search, category, tone, sort, page = 1, limit = 6 } = req.query;
            
            // ১. বেস কোয়েরি (শুধুমাত্র Public লেসন)
            let query = { visibility: "Public" };

            // ২. সার্চ লজিক (Title অথবা Description এ কিওয়ার্ড খোঁজা)
            if (search) {
                query.$or = [
                    { title: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } }
                ];
            }

            // ৩. ক্যাটাগরি ফিল্টার
            if (category && category !== 'All') {
                query.category = category;
            }

            // ৪. ইমোশনাল টোন ফিল্টার
            if (tone && tone !== 'All') {
                query.emotionalTone = tone;
            }

            // ৫. সর্টিং অপশনস
            let sortOptions = { createdAt: -1 }; // Default: Newest
            if (sort === 'oldest') {
                sortOptions = { createdAt: 1 };
            } else if (sort === 'most-saved') {
                sortOptions = { favoritesCount: -1 };
            } else if (sort === 'most-liked') {
                sortOptions = { likesCount: -1 };
            }

            // ৬. পেজিনেশন ক্যালকুলেশন
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;

            // মোট কতগুলো ডকুমেন্ট ম্যাচ করেছে তা কাউন্ট করা
            const totalLessons = await lessonsCollection.countDocuments(query);
            const totalPages = Math.ceil(totalLessons / limitNum);

            // ডাটা ফেচিং
            const result = await lessonsCollection.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(limitNum)
                .toArray();

            res.json({
                lessons: result,
                pagination: {
                    totalLessons,
                    totalPages,
                    currentPage: pageNum,
                    limit: limitNum
                }
            });
        } catch (error) {
            console.error("Get Public Lessons Error:", error);
            res.status(500).json({ success: false, message: "Failed to fetch public lessons" });
        }
    });

    // নির্দিষ্ট সিঙ্গেল লেসন ডিটেইলস (GET - Details Page)
    app.get("/api/lessons/:id", async (req, res) => {
        try {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ success: false, message: "Invalid Object ID" });
            }
            const result = await lessonsCollection.findOne({ _id: new ObjectId(id) });
            if (!result) return res.status(404).json({ message: "Lesson not found" });
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: "Server Error" });
        }
    });

    // রিয়েল-টাইম নো-রিফ্রেশ লাইক বাটন লজিক (PATCH)
    app.patch("/api/lessons/:id/like", async (req, res) => {
        try {
            const id = req.params.id;
            const { email } = req.body;

            if (!ObjectId.isValid(id) || !email) return res.status(400).json({ message: "Invalid data" });

            const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
            if (!lesson) return res.status(404).json({ message: "Lesson not found" });

            const hasLiked = lesson.likes && lesson.likes.includes(email);
            
            // যদি ইউজার অলরেডি লাইক দিয়ে থাকে তবে রিমুভ হবে, না দিলে অ্যাড হবে (Toggle)
            const updateDoc = hasLiked 
                ? { $pull: { likes: email }, $inc: { likesCount: -1 } }
                : { $addToSet: { likes: email }, $inc: { likesCount: 1 } };

            const result = await lessonsCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: "Like action failed" });
        }
    });

    // কমেন্ট গেট করার রুট (GET)
    app.get("/api/lessons/:id/comments", async (req, res) => {
        try {
            const id = req.params.id;
            const result = await commentsCollection.find({ lessonId: id }).sort({ createdAt: -1 }).toArray();
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch comments" });
        }
    });

    // নতুন কমেন্ট পোস্ট করার রুট (POST)
    app.post("/api/lessons/:id/comments", async (req, res) => {
        try {
            const commentDoc = req.body;
            const result = await commentsCollection.insertOne(commentDoc);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: "Comment submission failed" });
        }
    });

    // ইন্যাপ্রোপ্রিয়েট কনটেন্ট রিপোর্টের রুট (POST)
    app.post("/api/reports", async (req, res) => {
        try {
            const reportData = req.body;
            const result = await reportsCollection.insertOne(reportData);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: "Reporting failed" });
        }
    });
   


  


    // লেসন গেট (GET)
    app.get("/api/lessons", async (req, res) => {
        try {
            const email = req.query.email;
            let query = {};
            if (email) query = { creatorEmail: email };
            const result = await lessonsCollection.find(query).toArray();
            res.json(result);
        } catch (error) {
            console.error("Get Lessons Error:", error);
            res.status(500).json({ success: false, message: "Failed to fetch lessons" });
        }
    });

    app.delete("/api/lessons/:id", async (req, res) => {
        try {
            const id = req.params.id;
            // ইনভ্যালিড আইডি চেক করার জন্য সেফটি গার্ড
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ success: false, message: "Invalid Object ID" });
            }
            const result = await lessonsCollection.deleteOne({ _id: new ObjectId(id) });
            res.json(result);
        } catch (error) {
            console.error("Delete Error:", error);
            res.status(500).json({ success: false, message: "Failed to delete lesson" });
        }
    });

    // লেসন আপডেট (PUT)
    app.put("/api/lessons/:id", async (req, res) => {
        try {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ success: false, message: "Invalid Object ID" });
            }
            const { _id, ...updatedData } = req.body; 
            const result = await lessonsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );
            res.json(result);
        } catch (error) {
            console.error("PUT Update Error:", error);
            res.status(500).json({ success: false, message: "Failed to update lesson" });
        }
    });

    // লেসন আপডেট (PATCH)
    app.patch("/api/lessons/:id", async (req, res) => {
        try {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ success: false, message: "Invalid Object ID" });
            }
            const result = await lessonsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: req.body }
            );
            res.json(result);
        } catch (error) {
            console.error("PATCH Update Error:", error);
            res.status(500).json({ success: false, message: "Failed to update lesson" });
        }
    });
    
    // সাবস্ক্রিপশন রাউট (POST)
    app.post('/subscription', async (req, res) => {
        try {
            const { sessionId, userId, userEmail } = req.body;

            // ডুপ্লিকেট সাবস্ক্রিপশন চেক
            const existing = await subscriptionCollection.findOne({ sessionId });
            if (existing) {
                return res.status(400).json({ success: false, message: "Already subscribed" });
            }

            // সাবস্ক্রিপশন ডেটা ইনসার্ট
            const result = await subscriptionCollection.insertOne({
                sessionId, userId, userEmail, createdAt: new Date()
            });
            
            // ইউজার প্ল্যান "Pro" তে আপডেট
            // ⚠️ মনে রাখবেন: Better-Auth এর আইডি সাধারণত String হয়, তাই ObjectId() ব্যবহার করা হয়নি।
            await usersCollection.updateOne(
                { _id: new ObjectId(userId)}, 
                { $set: { userPlan: "Pro" } }
            );

            res.status(200).json({ success: true, msg: "Payment successfully!!!" });
        } catch (error) {
            console.error("Subscription Error:", error);
            res.status(500).json({ success: false, message: "Internal server error during subscription" });
        }
    });

    // ==========================================
// 🔖 ১. ফেভারিট টগল রাউট (POST - Add/Remove Favorite)
// ==========================================
app.post("/api/lessons/:id/favorite", async (req, res) => {
    try {
        const id = req.params.id;
        const { email, toggle } = req.body; // toggle: true (অ্যাড), toggle: false (রিমুভ)

        if (!ObjectId.isValid(id) || !email) {
            return res.status(400).json({ message: "Invalid lesson ID or email missing" });
        }

        let updateDoc;
        if (toggle) {
            // ফেভারিট লিস্টে ইউজারের ইমেইল অ্যাড হবে এবং কাউন্টার ১ বাড়বে
            updateDoc = { 
                $addToSet: { favoritedBy: email }, 
                $inc: { favoritesCount: 1 } 
            };
        } else {
            // ফেভারিট লিস্ট থেকে ইউজারের ইমেইল রিমুভ হবে এবং কাউন্টার ১ কমবে
            updateDoc = { 
                $pull: { favoritedBy: email }, 
                $inc: { favoritesCount: -1 } 
            };
        }

        const result = await lessonsCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
        res.json({ success: true, result });
    } catch (error) {
        console.error("Favorite Toggle Error:", error);
        res.status(500).json({ message: "Favorite action failed" });
    }
});

// ==========================================
// 🔖 ২. ইউজারের সেভ করা ফেভারিট লিস্ট গেট রাউট (GET)
// ==========================================
app.get("/api/users/:email/favorites", async (req, res) => {
    try {
        const email = req.params.email;
        // যে সকল লেসনের favoritedBy অ্যারেতে এই ইউজারের ইমেইল আছে, সেগুলো খুঁজে বের করবে
        const query = { favoritedBy: email };
        const result = await lessonsCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        console.error("Get Favorites Error:", error);
        res.status(500).json({ message: "Failed to fetch favorites" });
    }
});

  } catch (error) {
      console.error("Database connection error:", error);
  }
}

run().catch(console.dir);

// --- বেস রাউট ---
app.get('/', (req, res) => {
  res.send('Digital Life Lessons Backend is Running! 🚀')
})

// --- সার্ভার লিসেনার ---
app.listen(port, () => {
  console.log(`📡 Server is blazing fast on port ${port}`)
})