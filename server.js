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
let typeCounts = {};
let samples = {};
let chatCount = 0;

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  libVersion: require('tiktok-live-connector/package.json').version,
  chatCount: chatCount,
  commentsStored: comments.length,
  typeCounts: typeCounts,
  samples: samples,
  eventLog: eventLog.slice(-15),
  lastError: lastError
}));
app.get('/', (req, res) => res.send('Relay running. Connected: ' + (connectedUser || 'none')));

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null; eventLog = []; typeCounts = {}; samples = {}; chatCount = 0;
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, { signApiKey: EULER_KEY });

    const origEmit = conn.emit.bind(conn);
    conn.emit = function(name) {
      eventLog.push(String(name));
      if (eventLog.length > 60) eventLog.shift();
      return origEmit.apply(conn, arguments);
    };

    function tryExtractChat(data) {
      const payload = data.payload || data;
      let uid = '';
      if (payload.user && payload.user.uniqueId) uid = payload.user.uniqueId;
      else if (payload.uniqueId) uid = payload.uniqueId;

      let txt = '';
      if (payload.content) txt = payload.content;
      else if (payload.comment) txt = payload.comment;
      else if (payload.common && payload.common.displayText) txt = payload.common.displayText;

      if (uid && txt) {
        chatCount++;
        console.log('CHAT EXTRACTED:', uid, '->', txt);
        comments.push({ user: uid, text: txt, gift: '' });
        if (comments.length > 200) comments.shift();
        return true;
      }
      return false;
    }

    conn.on('decodedData', (data) => {
      if (!data) return;
      let t = 'unknown';
      if (typeof data.type === 'string') t = data.type;
      else if (typeof data.type === 'number') t = 'num:' + data.type;
      else if (data.common && typeof data.common.type === 'string') t = data.common.type;

      typeCounts[t] = (typeCounts[t] || 0) + 1;

      if (!samples[t] && Object.keys(samples).length < 6) {
        try { samples[t] = JSON.stringify(data).substring(0, 400); }
        catch (e) { samples[t] = 'unserializable'; }
      }

      tryExtractChat(data);
    });

    conn.on('chat', (d) => {
      console.log('CHAT EVENT:', JSON.stringify(d).substring(0, 200));
      tryExtractChat(d);
    });

    conn.on('gift', (d) => {
      if (d.giftType === 1 && !d.repeatEnd) return;
      const payload = d.payload || d;
      const uid = (payload.user && payload.user.uniqueId) || payload.uniqueId || '';
      const gname = payload.giftName || (payload.gift && payload.gift.name) || '';
      if (uid && gname) {
        gifts.push({ user: uid, gift: gname, target: '' });
        if (gifts.length > 200) gifts.shift();
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
