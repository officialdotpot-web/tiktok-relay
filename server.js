const express = require('express');
const { TikTokLiveConnection } = require('tiktok-live-connector');
const app = express();
const PORT = process.env.PORT || 8081;

// Read from env first, fall back to hardcoded. Replace PASTE_KEY_HERE with your actual key.
const EULER_KEY = process.env.EULER_KEY || process.env.SIGN_API_KEY || 'PASTE_KEY_HERE';

let comments = [];
let gifts = [];
let conn = null;
let connectedUser = null;
let lastError = null;

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  hasKey: EULER_KEY !== 'PASTE_KEY_HERE' && EULER_KEY !== undefined,
  keyLength: EULER_KEY ? EULER_KEY.length : 0,
  lastError: lastError
}));
app.get('/', (req, res) => res.send('Relay is running. Connected: ' + (connectedUser || 'none')));

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null;
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, {
      processInitialData: false,
      connectWithUniqueId: true,
      disableEulerFallbacks: false,
      signApiKey: EULER_KEY
    });
    await conn.connect();
    connectedUser = user;
    comments = [];
    gifts = [];
    console.log('CONNECTED to @' + user);

    conn.on('chat', d => {
      const uid = d.uniqueId || d.userId || d.nickname || 'unknown';
      const txt = d.comment || d.text || d.message || '';
      console.log('CHAT:', uid, '->', txt);
      comments.push({ user: uid, text: txt, gift: '' });
      if (comments.length > 200) comments.shift();
    });

    conn.on('gift', d => {
      if (d.giftType === 1 && !d.repeatEnd) return;
      const uid = d.uniqueId || d.userId || 'unknown';
      const gname = d.giftName || d.gift_name || d.gift || '';
      gifts.push({ user: uid, gift: gname, target: '' });
      if (gifts.length > 200) gifts.shift();
    });

    res.send('ok');
  } catch (e) {
    lastError = e.message;
    // Dig into the aggregated FetchIsLiveError to find the real cause
    if (e.errors && Array.isArray(e.errors)) {
      lastError = e.errors.map(function(err) { return err.message; }).join(' | ');
    }
    console.log('CONNECT FAILED:', lastError);
    res.status(500).send(lastError);
  }
});

app.listen(PORT, () => console.log('Relay on port ' + PORT));
