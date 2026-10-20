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
let chatCount = 0;

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  keyLength: EULER_KEY.length,
  libVersion: require('tiktok-live-connector/package.json').version,
  chatCount: chatCount,
  commentsStored: comments.length,
  eventLog: eventLog.slice(-20),
  lastError: lastError
}));
app.get('/', (req, res) => res.send('Relay running. Connected: ' + (connectedUser || 'none')));

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null;
  eventLog = [];
  chatCount = 0;
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, { signApiKey: EULER_KEY });

    // Log every event so we can see what's firing
    const origEmit = conn.emit.bind(conn);
    conn.emit = function(eventName) {
      eventLog.push(String(eventName));
      if (eventLog.length > 60) eventLog.shift();
      return origEmit.apply(conn, arguments);
    };

    // Helper: pull user + text out of any TikTok data shape
    function extract(d) {
      const u = d.user || d;
      const uid = u.uniqueId || u.userId || u.nickname || d.uniqueId || '';
      const txt = d.content || d.comment || d.text ||
                  (d.common && d.common.displayText) ||
                  (d.displayText) || '';
      return { uid, txt };
    }

    function recordChat(d) {
      const { uid, txt } = extract(d);
      if (!uid || !txt) return;
      chatCount++;
      console.log('CHAT:', uid, '->', txt);
      comments.push({ user: uid, text: txt, gift: '' });
      if (comments.length > 200) comments.shift();
    }

    function recordGift(d) {
      if (d.giftType === 1 && !d.repeatEnd) return;
      const { uid } = extract(d);
      const gname = d.giftName || d.gift_name || (d.gift && d.gift.name) || '';
      if (!uid || !gname) return;
      console.log('GIFT:', uid, '->', gname);
      gifts.push({ user: uid, gift: gname, target: '' });
      if (gifts.length > 200) gifts.shift();
    }

    // Try every possible event name the library might use
    if (WebcastEvent && WebcastEvent.CHAT) conn.on(WebcastEvent.CHAT, recordChat);
    if (WebcastEvent && WebcastEvent.GIFT) conn.on(WebcastEvent.GIFT, recordGift);
    conn.on('chat', recordChat);
    conn.on('gift', recordGift);

    // THE CRITICAL FIX: parse raw decodedData directly
    conn.on('decodedData', (data) => {
      if (!data) return;
      const type = data.type || (data.common && data.common.type) || '';
      const payload = data.payload || data;
      if (type.indexOf('Chat') !== -1 || (payload && payload.common && payload.common.displayText && !payload.giftId)) {
        recordChat(payload);
      } else if (type.indexOf('Gift') !== -1 || (payload && payload.giftId)) {
        recordGift(payload);
      }
    });

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
