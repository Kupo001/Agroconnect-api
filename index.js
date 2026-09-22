// @ts-nocheck
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const redis = require('redis');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Real PostgreSQL Connection Pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 20, 
  idleTimeoutMillis: 30000 
});

// Initialize Redis Client for Session State
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

// API Endpoint for React Dashboard to fetch real inventory
app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tbl_inventory WHERE status = 'Available' ORDER BY listed_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Database Connection Failed" });
  }
});

// Africa's Talking USSD Webhook
app.post('/ussd', async (req, res) => {
  console.log("INCOMING USSD DIAL FROM AFRICA'S TALKING NETWORK");
  
  try {
    const { sessionId, phoneNumber, text } = req.body;
    let response = '';
    const textArray = text.split('*');

    // Step 0: Initial Dial
    if (text === '') {
      response = `CON Welcome to AgroConnect Ekiti\n1. List New Harvest\n2. Check Available Market Rates`;
    } 
    // Step 1: Select Crop
    else if (text === '1') {
      response = `CON Select Produce Type:\n1. Cocoa\n2. Yam (Ilasa)\n3. Local Rice (Igbemo)`;
      await redisClient.setEx(`${sessionId}_step`, 180, 'CROP_SELECTION');
    } 
    // Step 2: Enter Quantity
    else if (textArray.length === 2 && textArray[0] === '1') {
      response = `CON Enter Quantity (in units/bags):`;
    } 
    // Step 3: Enter Price (The missing step from the audit)
    else if (textArray.length === 3 && textArray[0] === '1') {
      response = `CON Enter Price per unit (NGN):`;
    }
    // Step 4: Final Database Commit
    else if (textArray.length === 4 && textArray[0] === '1') {
      const cropCode = textArray[1];
      const quantity = parseInt(textArray[2]);
      const price = parseFloat(textArray[3]);
      
      const cropName = cropCode === '1' ? 'Cocoa' : cropCode === '2' ? 'Yam' : 'Local Rice';

      // Genuine PostgreSQL INSERT operation
      await pool.query(
        `INSERT INTO tbl_inventory (farmer_id, crop_type, quantity, price_per_unit) 
         VALUES ((SELECT user_id FROM tbl_users WHERE phone_number = $1 LIMIT 1), $2, $3, $4)`,
        [phoneNumber, cropName, quantity, price]
      );

      response = `END Success! ${quantity} units of ${cropName} listed at NGN ${price}.`;
      console.log("Database transaction successful.");
    } 
    else {
      response = `END Invalid selection. Please dial again.`;
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
    
  } catch (error) {
    console.error("Server Error Exception:", error);
    res.set('Content-Type', 'text/plain');
    res.send(`END System Error. Please try again later.`);
  }
});

app.listen(PORT, () => {
  console.log(`Worker thread running on port ${PORT}`);
});
// WhatsApp Webhook (Meta / Twilio API Integration)
app.post('/whatsapp', async (req, res) => {
  console.log("INCOMING WHATSAPP MESSAGE");
  
  try {
    // Twilio WhatsApp payloads use 'From' and 'Body'
    const sender = req.body.From; 
    const incomingText = req.body.Body.trim().toLowerCase();
    let replyMessage = '';

    // Step 0: Initial Greeting / Menu
    if (incomingText === 'hi' || incomingText === 'hello') {
      replyMessage = `Welcome to AgroConnect Ekiti! 🌾\nReply with a number:\n1. List New Harvest (Farmers)\n2. Browse Produce (Buyers)\n3. Pending Escrow (Agents)`;
    }
    // Step 1: Farmer Listing Route
    else if (incomingText === '1') {
      replyMessage = `What crop are you listing?\nReply format: CROP, QUANTITY, PRICE\nExample: Cocoa, 50, 2500`;
    }
    // Step 2: Database Commit Route (Parsing the comma-separated reply)
    else if (incomingText.includes(',')) {
      const [cropName, quantityStr, priceStr] = incomingText.split(',');
      const quantity = parseInt(quantityStr.trim());
      const price = parseFloat(priceStr.trim());
      
      // Genuine PostgreSQL INSERT utilizing the existing connection pool
      await pool.query(
        `INSERT INTO tbl_inventory (farmer_id, crop_type, quantity, price_per_unit) 
         VALUES ((SELECT user_id FROM tbl_users WHERE phone_number = $1 LIMIT 1), $2, $3, $4)`,
        [sender.replace('whatsapp:', ''), cropName.trim(), quantity, price]
      );
      
      replyMessage = `✅ Success! ${quantity} units of ${cropName.trim()} have been listed at NGN ${price}.`;
    } 
    else {
      replyMessage = `Invalid input. Send 'Hi' to see the main menu.`;
    }

    // Return TwiML (XML) response for Twilio WhatsApp API
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${replyMessage}</Message></Response>`);
    
  } catch (error) {
    console.error("WhatsApp Server Error:", error);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>System Offline. Try again later.</Message></Response>`);
  }
});
