const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

dotenv.config();

const app = express();
const port = process.env.PORT || 8000; // ব্যাকআপ পোর্ট ৮০০০ রাখা হলো
const uri = process.env.MONGODB_URI;

// --- ১. মিডলওয়্যার কনফিগারেশন ---
app.use(cors({
    origin: 'http://localhost:3000', // আপনার ফ্রন্টএন্ড ইউআরএল
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json()); // রিকোয়েস্ট বডি পার্স করার জন্য অত্যন্ত জরুরি

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
    // নোট: ডেভেলপমেন্ট বা প্রোডাকশনে ক্লায়েন্ট কানেক্ট করার দরকার পড়ে, তাই v4.7+ হলেও এটি রাখা নিরাপদ
    await client.connect();
    
    const db = client.db("digital-lessons");
    const lessonsCollection = db.collection("lessions-add");
    
    console.log("🔒 Successfully connected to MongoDB Atlas!");

    // --- ৩. এপিআই রাউটস (ডাটাবেজ কানেকশনের ভেতরে) ---
    app.post("/api/lessons", async (req, res) => {
        try {
            const body = req.body;
            
            const addlessons = {
                ...body,
                createdAt: new Date().toISOString() // ফ্রন্টএন্ড সিঙ্কের জন্য ISO টাইমে সেভ করা বেস্ট
            };
            
            const result = await lessonsCollection.insertOne(addlessons);
            res.status(201).json(result);
        } catch (error) {
            console.error("Insert Error:", error);
            res.status(500).json({ success: false, message: "Database insertion failed" });
        }
    });

  } catch (error) {
      console.error("Database connection error:", error);
  }
  // এখানে client.close() দেওয়া যাবে না, কারণ এক্সপ্রেস রানিং থাকা অবস্থায় কানেকশন ওপেন রাখতে হবে।
}

// ডাটাবেজ ফাংশনটি রান করান
run().catch(console.dir);

// --- ৪. বেস রাউটস ---
app.get('/', (req, res) => {
  res.send('Digital Life Lessons Backend is Running! 🚀')
})

// --- ৫. সার্ভার লিসেনার ---
app.listen(port, () => {
  console.log(`📡 Server is blazing fast on port ${port}`)
})