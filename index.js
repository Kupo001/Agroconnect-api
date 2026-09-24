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
  const { sessionId, phoneNumber, text } = req.body;
  let response = '';

  // Africa's Talking sends nested inputs separated by asterisks (e.g., "1*Samuel*Ado-Ekiti")
  const textArray = text.split('*');

  try {
    if (text === '') {
      response = 'CON Welcome to AgroConnect Ekiti \n1. Register Farmer \n2. Check Weather';
    } else if (textArray[0] === '1' && textArray.length === 1) {
      response = 'CON Enter your full name:';
    } else if (textArray[0] === '1' && textArray.length === 2) {
      response = 'CON Enter your town (e.g., Ado-Ekiti):';
    } else if (textArray[0] === '1' && textArray.length === 3) {
      const fullName = textArray[1];
      const town = textArray[2];
      
      const insertQuery = `
        INSERT INTO tbl_users (name, phone, town, role) 
        VALUES ($1, $2, $3, 'Farmer') RETURNING id
      `;
      // Execute the database insertion
      await pool.query(insertQuery, [fullName, phoneNumber, town]);
      
      response = `END Registration successful, ${fullName}. Your profile is active.`;
    } else if (text === '2') {
      response = 'END The weather in Ekiti is currently sunny.';
    } else {
      response = 'END Invalid input. Please try again.';
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);

  } catch (error) {
    console.error("USSD Transaction Error:", error);
    res.set('Content-Type', 'text/plain');
    res.send('END A network error occurred. Please try again.');
  }
});

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

   


    
  
