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
let chatCount = 0;
let giftCount = 0;
let lastChat = null;
let lastGift = null;

app.get('/comments', (req, res) => res.json(comments));
app.get('/gifts', (req, res) => res.json(gifts));
app.get('/status', (req, res) => res.json({
  connected: connectedUser,
  libVersion: require('tiktok-live-connector/package.json').version,
  chatCount: chatCount,
  giftCount: giftCount,
  commentsStored: comments.length,
  giftsStored: gifts.length,
  lastChat: lastChat,
  lastGift: lastGift,
  lastError: lastError
}));
app.get('/', (req, res) => res.send('Relay running. Connected: ' + (connectedUser || 'none')));

function pickUser(d) {
  if (!d) return '';
  return d.uniqueId || (d.user && d.user.uniqueId) || (d.user && d.user.nickname) || '';
}

function recordChat(uid, txt) {
  if (!uid || !txt) return false;
  chatCount++;
  lastChat = { user: uid, text: txt };
  console.log('CHAT:', uid, '->', txt);
  comments.push({ user: uid, text: txt, gift: '' });
  if (comments.length > 200) comments.shift();
  return true;
}

function recordGift(uid, gname) {
  if (!uid || !gname) return false;
  giftCount++;
  lastGift = { user: uid, gift: gname };
  console.log('GIFT:', uid, '->', gname);
  gifts.push({ user: uid, gift: gname, target: '' });
  if (gifts.length > 200) gifts.shift();
  return true;
}

app.post('/connect', async (req, res) => {
  const user = (req.query.user || '').replace('@', '').trim();
  if (!user) return res.status(400).send('No username');
  lastError = null; chatCount = 0; giftCount = 0; lastChat = null; lastGift = null;
  try {
    if (conn) { try { conn.disconnect(); } catch (e) {} }
    conn = new TikTokLiveConnection(user, {
      signApiKey: EULER_KEY,
      processInitialData: true
    });

    // NATIVE chat event — this is what fires (we saw "chat" in eventLog)
    conn.on('chat', (d) => {
      if (!d) return;
      const uid = pickUser(d);
      const txt = d.comment || d.content || d.text || '';
      recordChat(uid, txt);
    });

    // NATIVE gift event
    conn.on('gift', (d) => {
      if (!d) return;
      if (d.giftType === 1 && !d.repeatEnd) return;
      const uid = pickUser(d);
      const gname = d.giftName || (d.gift && d.gift.name) || '';
      recordGift(uid, gname);
    });

    // Fallback: decodedData (payload is {type, data})
    conn.on('decodedData', (type, payload) => {
      const t = typeof type === 'string' ? type : '';
      if (t !== 'WebcastChatMessage' && t !== 'WebcastGiftMessage') return;
      const d = (payload && payload.data) ? payload.data : payload || {};
      const uid = pickUser(d);
      if (t === 'WebcastChatMessage') {
        const txt = d.content || d.comment || '';
        recordChat(uid, txt);
      } else {
        if (d.giftType === 1 && !d.repeatEnd) return;
        const gname = d.giftName || (d.gift && d.gift.name) || '';
        recordGift(uid, gname);
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
