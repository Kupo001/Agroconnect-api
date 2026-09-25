const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const initializeDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tbl_users (
        id SERIAL PRIMARY KEY, name VARCHAR(100), phone VARCHAR(50) UNIQUE, town VARCHAR(100), role VARCHAR(50), pin VARCHAR(4), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tbl_products (
        id SERIAL PRIMARY KEY, seller_phone VARCHAR(50), crop_name VARCHAR(100), price_per_unit VARCHAR(50), status VARCHAR(20) DEFAULT 'Available', buyer_phone VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Transactional Database Verified.");
  } catch (err) {
    console.error("DB Init Error:", err);
  }
};
initializeDB();

// --- REACT WEB API ENDPOINTS ---
app.post('/api/login', async (req, res) => {
  const { phone, pin } = req.body;
  try {
    const user = await pool.query('SELECT * FROM tbl_users WHERE phone = $1 AND pin = $2', [phone, pin]);
    if (user.rows.length > 0) res.json({ success: true, user: user.rows[0] });
    else res.status(401).json({ success: false, message: 'Invalid credentials' });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/register', async (req, res) => {
  const { name, phone, town, role, pin } = req.body;
  try {
    await pool.query(
      `INSERT INTO tbl_users (name, phone, town, role, pin) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (phone) DO NOTHING`, 
      [name, phone, town, role, pin]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Registration failed' }); }
});

app.get('/api/inventory', async (req, res) => {
  const users = await pool.query('SELECT * FROM tbl_users ORDER BY id DESC');
  res.json(users.rows);
});

app.get('/api/products', async (req, res) => {
  const products = await pool.query('SELECT * FROM tbl_products ORDER BY id DESC');
  res.json(products.rows);
});

// NEW: Web Endpoint for Farmers to list crops
app.post('/api/products', async (req, res) => {
  const { seller_phone, crop_name, price_per_unit } = req.body;
  try {
    await pool.query(
      "INSERT INTO tbl_products (seller_phone, crop_name, price_per_unit) VALUES ($1, $2, $3)", 
      [seller_phone, crop_name, price_per_unit]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to list product' }); }
});

app.post('/api/transaction', async (req, res) => {
  const { productId, action, phone } = req.body; 
  try {
    if (action === 'Buy') {
      await pool.query("UPDATE tbl_products SET status = 'Pending', buyer_phone = $1 WHERE id = $2", [phone, productId]);
    } else if (action === 'Confirm') {
      await pool.query("UPDATE tbl_products SET status = 'Sold' WHERE id = $1", [productId]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Transaction failed' }); }
});

// --- AFRICA'S TALKING USSD WEBHOOK ---
app.post('/ussd', async (req, res) => {
  const { phoneNumber, text } = req.body;
  const textArray = (text || '').split('*');
  let response = '';

  try {
    if (text === '') {
      response = 'CON AgroConnect Ekiti \n1. Register \n2. Buy Crops \n3. Sell Crops \n4. Agent Portal';
    } 
    else if (textArray[0] === '1') {
      if (textArray.length === 1) response = 'CON Role: \n1. Farmer \n2. Buyer \n3. Agent';
      else if (textArray.length === 2) response = 'CON Enter Full Name:';
      else if (textArray.length === 3) response = 'CON Enter Town:';
      else if (textArray.length === 4) response = 'CON Create 4-digit PIN:';
      else if (textArray.length === 5) {
        const roles = { '1': 'Farmer', '2': 'Buyer', '3': 'Agro Agent' };
        await pool.query(`INSERT INTO tbl_users (name, phone, town, role, pin) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (phone) DO NOTHING`, 
          [textArray[2], phoneNumber, textArray[3], roles[textArray[1]], textArray[4]]);
        response = `END Account created! Use PIN ${textArray[4]} to login online.`;
      }
    }
    else if (textArray[0] === '2') {
      if (textArray.length === 1) {
        const market = await pool.query("SELECT id, crop_name, price_per_unit FROM tbl_products WHERE status = 'Available' LIMIT 5");
        if (market.rows.length === 0) response = 'END Market empty.';
        else {
          response = 'CON Select Crop to Buy:\n' + market.rows.map(item => `${item.id}. ${item.crop_name} (${item.price_per_unit})`).join('\n');
        }
      } else if (textArray.length === 2) {
        await pool.query("UPDATE tbl_products SET status = 'Pending', buyer_phone = $1 WHERE id = $2", [phoneNumber, textArray[1]]);
        response = `END Purchase reserved! An agent will contact you.`;
      }
    }
    else if (textArray[0] === '3') {
      if (textArray.length === 1) response = 'CON Enter Crop Name:';
      else if (textArray.length === 2) response = 'CON Enter Price (e.g., 5000):';
      else if (textArray.length === 3) {
        await pool.query("INSERT INTO tbl_products (seller_phone, crop_name, price_per_unit) VALUES ($1, $2, $3)", [phoneNumber, textArray[1], `₦${textArray[2]}`]);
        response = 'END Crop listed successfully on the market.';
      }
    }
    else if (textArray[0] === '4') {
      if (textArray.length === 1) {
        const pending = await pool.query("SELECT id, crop_name FROM tbl_products WHERE status = 'Pending' LIMIT 5");
        if (pending.rows.length === 0) response = 'END No pending orders.';
        else {
          response = 'CON Select order to confirm:\n' + pending.rows.map(item => `${item.id}. ${item.crop_name}`).join('\n');
        }
      } else if (textArray.length === 2) {
        await pool.query("UPDATE tbl_products SET status = 'Sold' WHERE id = $1", [textArray[1]]);
        response = 'END Order confirmed. Status changed to Sold.';
      }
    } else {
      response = 'END Invalid input.';
    }
    res.set('Content-Type', 'text/plain').send(response);
  } catch (error) { res.set('Content-Type', 'text/plain').send('END System error.'); }
});

app.post('/whatsapp', (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Welcome to AgroConnect Ekiti! 🌾\nMarket updates are active.</Message></Response>`);
});

app.listen(port, () => console.log(`System active on port ${port}`));
