const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const redis = require('redis');

const app = express();
const port = process.env.PORT || 10000;

// 1. CRITICAL MIDDLEWARE: Handles URL-encoded telecom payloads and JSON API requests
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// 2. DATABASE: Neon.tech PostgreSQL with SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000
});

// BULLETPROOFING: Automatically create the database table when the server starts
const initializeDB = async () => {
  try {
    const tableQuery = `
      CREATE TABLE IF NOT EXISTS tbl_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        phone VARCHAR(50),
        town VARCHAR(100),
        role VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(tableQuery);
    console.log("Database table 'tbl_users' is ready and verified.");
  } catch (err) {
    console.error("Database Initialization Error:", err);
  }
};
initializeDB(); // Run the check on startup

// 3. CACHE: Upstash Redis connection
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

// --- UNIFIED ENDPOINTS ---

// A. React Dashboard API (CodeSandbox)
app.get('/api/inventory', async (req, res) => {
  try {
    // Fetch all users and order them by the newest entries first
    const result = await pool.query('SELECT * FROM tbl_users ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard DB Error:", err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// B. Africa's Talking USSD Webhook
app.post('/ussd', async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  
  // Parse the Africa's Talking text string (e.g., "1*Samuel*Ado-Ekiti")
  const textArray = (text || '').split('*');
  let response = '';

  try {
    if (text === '' || !text) {
      response = 'CON Welcome to AgroConnect Ekiti \n1. Register Farmer \n2. Check Weather';
    } else if (textArray[0] === '1' && textArray.length === 1) {
      response = 'CON Enter your full name:';
    } else if (textArray[0] === '1' && textArray.length === 2) {
      response = 'CON Enter your town (e.g., Ado-Ekiti):';
    } else if (textArray[0] === '1' && textArray.length === 3) {
      
      // Save directly to the verified PostgreSQL Database
      const fullName = textArray[1];
      const town = textArray[2];
      
      const insertQuery = `INSERT INTO tbl_users (name, phone, town, role) VALUES ($1, $2, $3, 'Farmer')`;
      await pool.query(insertQuery, [fullName, phoneNumber, town]);
      
      response = `END Registration successful, ${fullName}. Your profile is active.`;
    } else if (textArray[0] === '2') {
      response = 'END The weather in Ekiti is currently sunny.';
    } else {
      response = 'END Invalid input. Please try again.';
    }

    // Telecom standard required by Africa's Talking
    res.set('Content-Type', 'text/plain');
    res.send(response);
  } catch (error) {
    console.error("USSD Transaction Error:", error);
    res.set('Content-Type', 'text/plain');
    res.send('END A database network error occurred. Please try again.');
  }
});

// C. Twilio / Meta WhatsApp Webhook
app.post('/whatsapp', (req, res) => {
  const incomingMsg = (req.body.Body || '').trim().toLowerCase();
  
  let replyText = "Welcome to AgroConnect Ekiti! 🌾\n\nReply with:\n1. Check Crop Prices\n2. Register as Farmer/Buyer\n3. Weather Advisory";

  if (incomingMsg === '1') {
    replyText = "📊 *Current Market Prices (Ekiti)*:\n- Yam: ₦2,500 / tuber\n- Cassava: ₦18,500 / bag\n- Cocoa: ₦8,200 / kg";
  } else if (incomingMsg === '2') {
    replyText = "📝 To register, reply with your *Full Name* and *Town* (e.g., Samuel, Ado-Ekiti).";
  } else if (incomingMsg === '3') {
    replyText = "🌦️ *Agro-Weather Advisory*:\nScattered showers expected across Ado and Ikole Ekiti. Optimal soil moisture for planting.";
  }

  // Twilio standard requires TwiML XML format
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${replyText}</Message></Response>`);
});

// Start the Server
app.listen(port, () => {
  console.log(`AgroConnect Worker thread running on port ${port}`);
});


    
  
