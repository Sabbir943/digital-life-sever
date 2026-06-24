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
    const subscriptionCollection = db.collection('subscriptionData');
    console.log("🔒 Successfully connected to MongoDB Atlas!");

    // --- ৩. রাউটস কনফিগারেশন ---
  
    // লেসন তৈরি (POST)
    app.post("/api/lessons", async (req, res) => {
        try {
            const body = req.body;
            const addlessons = {
                ...body,
                createdAt: new Date().toISOString()
            };
            const result = await lessonsCollection.insertOne(addlessons);
            res.status(201).json(result);
        } catch (error) {
            console.error("Insert Error:", error);
            res.status(500).json({ success: false, message: "Database insertion failed" });
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

    // লেসন ডিলিট (DELETE)
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