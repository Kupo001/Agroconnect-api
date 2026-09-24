const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const redis = require('redis');

const app = express();
const port = process.env.PORT || 10000;

// 1. CRITICAL MIDDLEWARE: Parse Africa's Talking URL-encoded payloads
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// 2. DATABASE: Neon.tech PostgreSQL with SSL enabled
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000
});

// 3. CACHE: Upstash Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

// --- ENDPOINTS ---

// A. Wake-up / Database Test Route
app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tbl_users LIMIT 1');
    res.json(result.rows);
  } catch (err) {
    console.error("DB Error:", err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// B. Africa's Talking USSD Webhook
app.post('/ussd', async (req, res) => {
  console.log("INCOMING USSD HIT FROM AT!", req.body);
  
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  let response = '';

  // Basic USSD Routing Logic
  if (text === '') {
    response = 'CON Welcome to AgroConnect Ekiti \n1. Register \n2. Check Weather';
  } else if (text === '1') {
    response = 'CON Enter your full name:';
  } else if (text === '2') {
    response = 'END The weather in Ekiti is currently sunny.';
  } else {
    response = 'END Invalid input. Please try again.';
  }

  // Africa's Talking strictly requires text/plain format
  res.set('Content-Type', 'text/plain');
  res.send(response);
});

// C. Twilio / Meta WhatsApp Webhook
app.post('/whatsapp', (req, res) => {
  console.log("INCOMING WHATSAPP MESSAGE!", req.body);
  const incomingMsg = (req.body.Body || '').trim().toLowerCase();
  
  let replyText = "Welcome to AgroConnect Ekiti! 🌾\n\nReply with:\n1. Check Crop Prices\n2. Register as Farmer/Buyer\n3. Weather Advisory";

  if (incomingMsg === '1') {
    replyText = "📊 *Current Market Prices (Ekiti)*:\n- Yam: ₦2,500 / tuber\n- Cassava: ₦18,500 / bag\n- Cocoa: ₦8,200 / kg";
  } else if (incomingMsg === '2') {
    replyText = "📝 To register, reply with your *Full Name* and *Town* (e.g., Samuel, Ado-Ekiti).";
  } else if (incomingMsg === '3') {
    replyText = "🌦️ *Agro-Weather Advisory*:\nScattered showers expected across Ado and Ikole Ekiti. Optimal soil moisture for planting.";
  }

  // Twilio requires an XML TwiML response
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${replyText}</Message></Response>`);
});

// Start the Server
app.listen(port, () => {
  console.log(`AgroConnect Worker thread running on port ${port}`);
});

   


    
  
