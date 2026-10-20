const express = require('express');
const tlc = require('tiktok-live-connector');
const TikTokLiveConnection = tlc.TikTokLiveConnection;
const SignConfig = tlc.SignConfig;
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
let typeCounts = {};
let samples = {};
let chatCount = 0;
let rawMatches = [];

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  libVersion: require('tiktok-live-connector/package.json').version,
  chatCount: chatCount,
  commentsStored: comments.length,
  typeCounts: typeCounts,
  samples: samples,
  rawMatches: rawMatches,
  eventLog: eventLog.slice(-15),
  lastError: lastError
}));
app.get('/', (req, res) => res.send('Relay running. Connected: ' + (connectedUser || 'none')));

function extractUser(d) {
  if (!d) return '';
  if (d.user && d.user.uniqueId) return d.user.uniqueId;
  if (d.uniqueId) return d.uniqueId;
  return '';
}

function recordChat(uid, txt) {
  if (!uid || !txt) return false;
  chatCount++;
  console.log('CHAT:', uid, '->', txt);
  comments.push({ user: uid, text: txt, gift: '' });
  if (comments.length > 200) comments.shift();
  return true;
}

function handlePayload(type, payload) {
  const t = typeof type === 'string' ? type : 'unknown';
  typeCounts[t] = (typeCounts[t] || 0) + 1;

  if (!samples[t] && Object.keys(samples).length < 8) {
    try { samples[t] = JSON.stringify(payload).substring(0, 500); }
    catch (e) { samples[t] = 'unserializable'; }
  }

  // The payload is {type, data}. Content lives inside .data
  const d = (payload && payload.data) ? payload.data : payload || {};

  if (t.indexOf('Chat') !== -1) {
    const uid = extractUser(d);
    const txt = d.content || d.comment || (d.common && d.common.displayText) || '';
    recordChat(uid, txt);
  }

  if (t.indexOf('Gift') !== -1) {
    if (d.giftType === 1 && !d.repeatEnd) return;
    const uid = extractUser(d);
    const gname = d.giftName || (d.gift && d.gift.name) || '';
    if (uid && gname) {
      gifts.push({ user: uid, gift: gname, target: '' });
      if (gifts.length > 200) gifts.shift();
    }
  }
}

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null; eventLog = []; typeCounts = {}; samples = {}; chatCount = 0; rawMatches = [];
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, {
      signApiKey: EULER_KEY,
      processInitialData: true
    });

    const origEmit = conn.emit.bind(conn);
    conn.emit = function(name) {
      eventLog.push(String(name));
      if (eventLog.length > 60) eventLog.shift();
      return origEmit.apply(conn, arguments);
    };

    // Capture chat with the correct payload.data path
    conn.on('decodedData', (type, payload) => handlePayload(type, payload));

    // Fallback signature (some builds pass one object)
    conn.on('decodedData', (arg1) => {
      if (arg1 && arg1.type && arg1.data) handlePayload(arg1.type, arg1);
    });

    // Scan raw websocketData for chat-looking strings (debug only)
    conn.on('websocketData', (d) => {
      if (!d) return;
      try {
        const str = typeof d === 'string' ? d : JSON.stringify(d);
        if (str && str.indexOf('WebcastChatMessage') !== -1 && rawMatches.length < 3) {
          rawMatches.push(str.substring(0, 400));
        }
      } catch (e) {}
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
