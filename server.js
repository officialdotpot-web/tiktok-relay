const express = require('express');
const { TikTokLiveConnection, SignConfig } = require('tiktok-live-connector');
const app = express();
const PORT = process.env.PORT || 8081;

// Read key from either env var name
const EULER_KEY = (process.env.SIGN_API_KEY || process.env.EULER_KEY || '').trim();

// THE OFFICIAL WAY: set it globally before creating any connection
SignConfig.apiKey = EULER_KEY;

let comments = [];
let gifts = [];
let conn = null;
let connectedUser = null;
let lastError = null;

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  keyLength: EULER_KEY.length,
  keyStart: EULER_KEY.substring(0, 6),
  keyEnd: EULER_KEY.substring(EULER_KEY.length - 4),
  lastError: lastError
}));
app.get('/', (req, res) => res.send('Relay is running. Connected: ' + (connectedUser || 'none')));

// Direct test of the Euler API with your key
app.get('/test-key', async (req, res) => {
  const user = req.query.user || 'bannah12poo';
  try {
    const r = await fetch('https://tiktok.eulerstream.com/webcast/fetch_room_id?uniqueId=' + user, {
      headers: { 'x-api-key': EULER_KEY }
    });
    const body = await r.text();
    res.send({ status: r.status, body: body.substring(0, 500) });
  } catch (e) {
    res.send({ error: e.message });
  }
});

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null;
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, {
      processInitialData: false,
      connectWithUniqueId: true,
      signApiKey: EULER_KEY
    });
    await conn.connect();
    connectedUser = user;
    comments = [];
    gifts = [];
    console.log('CONNECTED to @' + user);

    conn.on('chat', d => {
      const uid = d.uniqueId || d.userId || 'unknown';
      const txt = d.comment || d.text || '';
      console.log('CHAT:', uid, '->', txt);
      comments.push({ user: uid, text: txt, gift: '' });
      if (comments.length > 200) comments.shift();
    });

    conn.on('gift', d => {
      if (d.giftType === 1 && !d.repeatEnd) return;
      const uid = d.uniqueId || d.userId || 'unknown';
      const gname = d.giftName || d.gift_name || '';
      gifts.push({ user: uid, gift: gname, target: '' });
      if (gifts.length > 200) gifts.shift();
    });

    res.send('ok');
  } catch (e) {
    lastError = e.message;
    if (e.errors && Array.isArray(e.errors)) {
      lastError = e.errors.map(function(err) { return err.message; }).join(' | ');
    }
    console.log('CONNECT FAILED:', lastError);
    res.status(500).send(lastError);
  }
});

app.listen(PORT, () => console.log('Relay on port ' + PORT + ' | keyLength=' + EULER_KEY.length));
