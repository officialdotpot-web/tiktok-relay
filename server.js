const express = require('express');
const { TikTokLiveConnection, SignConfig, WebcastEvent } = require('tiktok-live-connector');
const app = express();
const PORT = process.env.PORT || 8081;

const EULER_KEY = (process.env.SIGN_API_KEY || process.env.EULER_KEY || '').trim();
SignConfig.apiKey = EULER_KEY;

let comments = [];
let gifts = [];
let conn = null;
let connectedUser = null;
let lastError = null;
let eventCount = 0;
let lastEventAt = null;

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  keyLength: EULER_KEY.length,
  eventCount: eventCount,
  lastEventAt: lastEventAt,
  commentsStored: comments.length,
  giftsStored: gifts.length,
  lastError: lastError,
  libVersion: require('tiktok-live-connector/package.json').version
}));
app.get('/', (req, res) => res.send('Relay is running. Connected: ' + (connectedUser || 'none') + ' | events: ' + eventCount));

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null;
  eventCount = 0;
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, {
      processInitialData: true,
      connectWithUniqueId: true,
      signApiKey: EULER_KEY
    });

    // Register handlers BEFORE connecting
    conn.on('chat', d => {
      eventCount++;
      lastEventAt = new Date().toISOString();
      const uid = d.uniqueId || d.userId || 'unknown';
      const txt = d.comment || d.text || '';
      console.log('CHAT:', uid, '->', txt);
      comments.push({ user: uid, text: txt, gift: '' });
      if (comments.length > 200) comments.shift();
    });

    conn.on('gift', d => {
      eventCount++;
      lastEventAt = new Date().toISOString();
      if (d.giftType === 1 && !d.repeatEnd) return;
      const uid = d.uniqueId || d.userId || 'unknown';
      const gname = d.giftName || d.gift_name || '';
      console.log('GIFT:', uid, '->', gname);
      gifts.push({ user: uid, gift: gname, target: '' });
      if (gifts.length > 200) gifts.shift();
    });

    conn.on('member', d => { eventCount++; lastEventAt = new Date().toISOString(); console.log('MEMBER:', d.uniqueId); });
    conn.on('sub', d => { eventCount++; lastEventAt = new Date().toISOString(); console.log('SUB:', d.uniqueId); });
    conn.on('connected', s => { console.log('WS CONNECTED:', s.roomId); });
    conn.on('disconnected', r => { console.log('WS DISCONNECTED:', r); });
    conn.on('error', e => { console.log('WS ERROR:', e.message || e); });

    await conn.connect();
    connectedUser = user;
    console.log('CONNECTED to @' + user);
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
