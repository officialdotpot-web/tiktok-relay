const express = require('express');
const { TikTokLiveConnection } = require('tiktok-live-connector');
const app = express();
const PORT = 8081;

let comments = [];
let gifts = [];
let conn = null;

// ⚠️ PASTE YOUR API KEY INSIDE THE QUOTES BELOW
const MY_API_KEY = "euler_NWJkNGYxMjhmNDYxNDU3MTk3Mjg1ZjFkMGUzMjQyOTBjMmUzZmExZDRkZTNhMzZmODc1ZDY0";

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/', (req, res) => res.send('Relay is running'));

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '');
  if (!user) return res.status(400).send('No username given');
  
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    
    conn = new TikTokLiveConnection(user, {
      processInitialData: false,
      signApiKey: MY_API_KEY
    });
    
    await conn.connect();
    comments = [];
    gifts = [];
    console.log('CONNECTED to @' + user);
    
    conn.on('chat', d => {
      console.log('COMMENT: ' + d.uniqueId + ': ' + d.comment);
      comments.push({ user: d.uniqueId, text: d.comment, gift: '' });
      if (comments.length > 200) comments.shift();
    });
    
    conn.on('gift', d => {
      if (d.giftType === 1 && !d.repeatEnd) return;
      console.log('GIFT: ' + d.uniqueId + ' sent ' + d.giftName);
      gifts.push({ user: d.uniqueId, gift: d.giftName, target: '' });
      if (gifts.length > 200) gifts.shift();
    });
    
    res.send('ok');
  } catch (e) {
    console.log('CONNECT FAILED: ' + e.message);
    res.status(500).send(e.message);
  }
});

app.listen(PORT, () => {
  console.log('Relay running on http://127.0.0.1:' + PORT);
});