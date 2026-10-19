const express = require('express');
const { TikTokLiveConnection } = require('tiktok-live-connector');
const app = express();
const PORT = process.env.PORT || 8081;

let comments = [];
let gifts = [];
let conn = null;
let connectedUser = null;

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/', (req, res) => res.send('Relay is running. Connected: ' + (connectedUser || 'none')));

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, {
      processInitialData: false,
      connectWithUniqueId: true,
      signApiKey: process.env.EULER_KEY
    });
    await conn.connect();
    connectedUser = user;
    comments = [];
    gifts = [];
    console.log('CONNECTED to @' + user);

    conn.on('chat', d => {
      console.log('RAW CHAT:', JSON.stringify(d));
      const uid = d.uniqueId || d.userId || d.nickname || 'unknown';
      const txt = d.comment || d.text || d.message || '';
      console.log('PARSED -> user:', uid, '| text:', txt);
      comments.push({ user: uid, text: txt, gift: '' });
      if (comments.length > 200) comments.shift();
    });

    conn.on('gift', d => {
      console.log('RAW GIFT:', JSON.stringify(d));
      if (d.giftType === 1 && !d.repeatEnd) return;
      const uid = d.uniqueId || d.userId || 'unknown';
      const gname = d.giftName || d.gift_name || d.gift || '';
      gifts.push({ user: uid, gift: gname, target: '' });
      if (gifts.length > 200) gifts.shift();
    });

    res.send('ok');
  } catch (e) {
    console.log('CONNECT FAILED:', e.message);
    res.status(500).send(e.message);
  }
});

app.listen(PORT, () => console.log('Relay on port ' + PORT));
