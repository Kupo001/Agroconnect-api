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

// BULLETPROOFING: Automatically create database tables when the server starts
const initializeDB = async () => {
  try {
    // Create Users Table
    const usersTable = `
      CREATE TABLE IF NOT EXISTS tbl_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(50),
        town VARCHAR(100),
        role VARCHAR(50) DEFAULT 'User',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(usersTable);

    // Create Products/Marketplace Table
    const productsTable = `
      CREATE TABLE IF NOT EXISTS tbl_products (
        id SERIAL PRIMARY KEY,
        seller_name VARCHAR(100),
        seller_phone VARCHAR(50),
        crop_name VARCHAR(100),
        price_per_unit VARCHAR(50),
        status VARCHAR(20) DEFAULT 'Available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(productsTable);

    console.log("Database tables 'tbl_users' and 'tbl_products' are ready and verified.");
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

// A. React Dashboard API: Fetch All Users (Farmers, Buyers, Agents)
app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tbl_users ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard Users Error:", err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// B. React Dashboard API: Fetch All Market Products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tbl_products ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard Products Error:", err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// C. Africa's Talking USSD Webhook
app.post('/ussd', async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  const textArray = (text || '').split('*');
  let response = '';

  try {
    // MAIN MENU
    if (text === '' || !text) {
      response = 'CON Welcome to AgroConnect Ekiti \n1. Register \n2. View Market (Buyers) \n3. List Crop (Farmers)';
    } 
    
    // ROUTE 1: REGISTRATION FLOW (Dynamic Roles)
    else if (textArray[0] === '1') {
      if (textArray.length === 1) {
        response = 'CON Select Role: \n1. Farmer \n2. Buyer \n3. Agro Agent';
      } else if (textArray.length === 2) {
        response = 'CON Enter your full name:';
      } else if (textArray.length === 3) {
        response = 'CON Enter your town (e.g., Ado-Ekiti):';
      } else if (textArray.length === 4) {
        // Map the numeric input to the actual role string
        const roleMap = { '1': 'Farmer', '2': 'Buyer', '3': 'Agro Agent' };
        const selectedRole = roleMap[textArray[1]] || 'User';
        const fullName = textArray[2];
        const town = textArray[3];
        
        const insertQuery = `INSERT INTO tbl_users (name, phone, town, role) VALUES ($1, $2, $3, $4)`;
        await pool.query(insertQuery, [fullName, phoneNumber, town, selectedRole]);
        
        response = `END ${selectedRole} profile created successfully for ${fullName}!`;
      }
    }

    // ROUTE 2: BUYERS VIEWING MARKET
    else if (textArray[0] === '2') {
      const marketQuery = await pool.query('SELECT crop_name, price_per_unit FROM tbl_products LIMIT 3');
      if (marketQuery.rows.length === 0) {
        response = 'END The market is currently empty. Check back later.';
      } else {
        let marketList = 'END --- AgroConnect Market ---\n';
        marketQuery.rows.forEach((item, index) => {
          marketList += `${index + 1}. ${item.crop_name} - ${item.price_per_unit}\n`;
        });
        response = marketList;
      }
    }

    // ROUTE 3: FARMERS LISTING CROP
    else if (textArray[0] === '3') {
      if (textArray.length === 1) {
        response = 'CON Enter Crop Name (e.g., Yam):';
      } else if (textArray.length === 2) {
        response = 'CON Enter Price per unit (e.g., 2500):';
      } else if (textArray.length === 3) {
        const crop = textArray[1];
        const price = `₦${textArray[2]}`;
        
        const insertCrop = `INSERT INTO tbl_products (seller_name, seller_phone, crop_name, price_per_unit) VALUES ('Registered Farmer', $1, $2, $3)`;
        await pool.query(insertCrop, [phoneNumber, crop, price]);
        
        response = `END Your ${crop} has been listed on the market for ${price}.`;
      }
    } 
    
    else {
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

// D. Twilio / Meta WhatsApp Webhook
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
