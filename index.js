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
    app.get("/api/public-lessons", async (req, res) => {
        try {
            // শুধুমাত্র যেগুলো Public করা আছে সেগুলোই রিট্রিভ হবে
            const query = { visibility: "Public" };
            const result = await lessonsCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.json(result);
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