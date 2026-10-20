const express = require('express');
const tlc = require('tiktok-live-connector');
const TikTokLiveConnection = tlc.TikTokLiveConnection;
const SignConfig = tlc.SignConfig;
const WebcastEvent = tlc.WebcastEvent;
const app = express();
const PORT = process.env.PORT || 8081;

const EULER_KEY = (process.env.SIGN_API_KEY || process.env.EULER_KEY || '').trim();
SignConfig.apiKey = EULER_KEY;

let comments = [];
let gifts = [];
let conn = null;
let connectedUser = null;
let lastError = null;
let eventLog = [];

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  keyLength: EULER_KEY.length,
  libVersion: require('tiktok-live-connector/package.json').version,
  hasWebcastEvent: typeof WebcastEvent !== 'undefined',
  chatEventName: (typeof WebcastEvent !== 'undefined' && WebcastEvent.CHAT) ? String(WebcastEvent.CHAT) : 'undefined',
  eventLog: eventLog.slice(-15),
  lastError: lastError
}));
app.get('/', (req, res) => res.send('Relay running. Connected: ' + (connectedUser || 'none')));

app.post('/simulate', (req, res) => {
  const user = req.query.user || 'testuser';
  const text = req.query.text || 'join Roblox';
  comments.push({ user: user, text: text, gift: '' });
  res.send('simulated');
});

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null;
  eventLog = [];
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, { signApiKey: EULER_KEY });

    const origEmit = conn.emit.bind(conn);
    conn.emit = function(eventName) {
      eventLog.push(String(eventName));
      if (eventLog.length > 50) eventLog.shift();
      console.log('EVENT:', String(eventName));
      return origEmit.apply(conn, arguments);
    };

    const onChat = function(d) {
      const uid = d.uniqueId || (d.user && d.user.uniqueId) || 'unknown';
      const txt = d.comment || d.text || '';
      console.log('CHAT:', uid, '->', txt);
      comments.push({ user: uid, text: txt, gift: '' });
      if (comments.length > 200) comments.shift();
    };
    const onGift = function(d) {
      if (d.giftType === 1 && !d.repeatEnd) return;
      const uid = d.uniqueId || (d.user && d.user.uniqueId) || 'unknown';
      const gname = d.giftName || d.gift_name || '';
      gifts.push({ user: uid, gift: gname, target: '' });
      if (gifts.length > 200) gifts.shift();
    };

    if (WebcastEvent && WebcastEvent.CHAT) conn.on(WebcastEvent.CHAT, onChat);
    if (WebcastEvent && WebcastEvent.GIFT) conn.on(WebcastEvent.GIFT, onGift);
    conn.on('chat', onChat);
    conn.on('gift', onGift);

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

app.listen(PORT, () => console.log('Relay port ' + PORT + ' | keyLen ' + EULER_KEY.length));
