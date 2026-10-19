const express = require("express");
const app = express();
app.use(express.json({ limit: "20kb" }));
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHANNEL_LINK = process.env.TELEGRAM_CHANNEL_LINK || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN); res.setHeader("Vary", "Origin"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); if (req.method === "OPTIONS") return res.sendStatus(204); next(); });
app.get("/", (_req,res)=>res.json({ok:true,service:"ZyloBet Telegram membership API"}));
app.get("/config", (_req,res)=>res.json({channelLink:CHANNEL_LINK}));
function getChatIdFromLink(link){try{const u=new URL(link);if(!['t.me','www.t.me'].includes(u.hostname.toLowerCase()))return null;const slug=u.pathname.split('/').filter(Boolean)[0];if(!slug||slug==='s'||slug==='c'||slug.startsWith('+'))return null;return '@'+slug;}catch{return null;}}
async function telegram(method,body){const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {http:r.status,data:await r.json()};}
app.get('/channel-info',async(req,res)=>{try{if(!BOT_TOKEN)return res.status(503).json({ok:false,error:'SERVER_NOT_CONFIGURED'});const link=String(req.query.link||CHANNEL_LINK);const chatId=getChatIdFromLink(link);if(!chatId)return res.status(400).json({ok:false,error:'INVALID_PUBLIC_CHANNEL_LINK'});const out=await telegram('getChat',{chat_id:chatId});if(!out.data.ok)return res.status(502).json({ok:false,error:'TELEGRAM_GET_CHAT_FAILED',message:'Confirm this is a public channel and the bot can access it.'});const chat=out.data.result;let photoUrl='';if(chat.photo&&chat.photo.big_file_id){photoUrl=`${req.protocol}://${req.get('host')}/channel-photo?link=${encodeURIComponent(link)}`;}return res.json({ok:true,title:chat.title||chat.username||'Telegram Channel',username:chat.username||'',photoUrl});}catch(e){console.error('Channel info error:',e);return res.status(500).json({ok:false,error:'INTERNAL_ERROR'});}});
app.get('/channel-photo',async(req,res)=>{try{if(!BOT_TOKEN)return res.sendStatus(503);const link=String(req.query.link||CHANNEL_LINK);const chatId=getChatIdFromLink(link);if(!chatId)return res.sendStatus(400);const c=await telegram('getChat',{chat_id:chatId});if(!c.data.ok||!c.data.result.photo)return res.sendStatus(404);const photo=c.data.result.photo;const fileId=photo.big_file_id||photo.small_file_id;if(!fileId)return res.sendStatus(404);const f=await telegram('getFile',{file_id:fileId});if(!f.data.ok||!f.data.result.file_path)return res.sendStatus(404);const img=await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${f.data.result.file_path}`);if(!img.ok)return res.sendStatus(502);res.setHeader('Content-Type',img.headers.get('content-type')||'image/jpeg');res.setHeader('Cache-Control','public, max-age=300');return res.send(Buffer.from(await img.arrayBuffer()));}catch(e){console.error('Channel photo error:',e);return res.sendStatus(500);}});
app.post('/verify',async(req,res)=>{try{if(!BOT_TOKEN)return res.status(503).json({ok:false,error:'SERVER_NOT_CONFIGURED',message:'Set TELEGRAM_BOT_TOKEN in Render environment variables.'});const userId=String(req.body&&req.body.telegramUserId||'').trim();if(!/^\d{1,20}$/.test(userId))return res.status(400).json({ok:false,error:'INVALID_TELEGRAM_USER_ID'});const requestedLink=String(req.body&&req.body.channelLink||'').trim();const dynamicChatId=requestedLink?getChatIdFromLink(requestedLink):null;const chatId=dynamicChatId||CHAT_ID;if(!chatId)return res.status(400).json({ok:false,error:'INVALID_CHANNEL_LINK',message:'Pass a valid public channel link.'});const out=await telegram('getChatMember',{chat_id:chatId,user_id:userId});if(!out.data.ok)return res.status(502).json({ok:false,error:'TELEGRAM_CHECK_FAILED',message:'Could not check membership. Confirm the bot is an administrator and TELEGRAM_CHAT_ID is correct.'});const status=out.data.result&&out.data.result.status;const isMember=['creator','administrator','member'].includes(status)||(status==='restricted'&&out.data.result.is_member===true);return res.json({ok:true,isMember,status,channelLink:requestedLink||CHANNEL_LINK});}catch(e){console.error('Membership verification error:',e);return res.status(500).json({ok:false,error:'INTERNAL_ERROR'});}});


// Shared Rocket Crash round state. Configure UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN for durable cross-instance state.
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
async function redisCommand(command) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('SHARED_STORAGE_NOT_CONFIGURED');
  const r = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const j = await r.json(); if (!r.ok || j.error) throw new Error('REDIS_COMMAND_FAILED'); return j.result;
}
const ROUND_KEY = 'zylobet:rocket:round:v1';
const HISTORY_KEY = 'zylobet:rocket:history:v1';
const roundLockKey = 'zylobet:rocket:round-lock:v1';
function makeCrashPoint() { const u = Math.max(0.000001, Math.random()); return Math.max(1.01, Math.min(30, Math.floor((1 / u) * 100) / 100)); }
app.get('/game/state', async (_req, res) => {
  try {
    const raw = await redisCommand(['GET', ROUND_KEY]);
    let round = raw ? JSON.parse(raw) : null;
    const now = Date.now();
    if (!round || (round.phase === 'countdown' && now >= round.nextAt) || (round.phase === 'flight' && now >= round.crashAt)) {
      // Atomic lock prevents separate Render instances creating competing rounds.
      const lock = await redisCommand(['SET', roundLockKey, String(now), 'NX', 'EX', 4]);
      if (lock === 'OK') {
        const latestRaw = await redisCommand(['GET', ROUND_KEY]);
        const latest = latestRaw ? JSON.parse(latestRaw) : null;
        const t = Date.now();
        if (!latest) {
          round = { id: 1, phase: 'countdown', startedAt: t, nextAt: t + 10000, crashAt: null, crashPoint: null };
        } else if (latest.phase === 'countdown' && t >= latest.nextAt) {
          round = { id: latest.id + 1, phase: 'flight', startedAt: t, nextAt: null, crashAt: t + Math.log(Math.max(1.01, makeCrashPoint())) / 0.00012, crashPoint: makeCrashPoint() };
          // crashAt is recomputed from the exact same point for a consistent multiplier.
          round.crashAt = t + Math.log(round.crashPoint) / 0.00012;
        } else if (latest.phase === 'flight' && t >= latest.crashAt) {
          const histRaw = await redisCommand(['GET', HISTORY_KEY]);
          const hist = histRaw ? JSON.parse(histRaw) : [];
          hist.unshift({ id: latest.id, crashPoint: latest.crashPoint, endedAt: t });
          await redisCommand(['SET', HISTORY_KEY, JSON.stringify(hist.slice(0, 12))]);
          round = { id: latest.id, phase: 'countdown', startedAt: t, nextAt: t + 10000, crashAt: null, crashPoint: null };
        } else round = latest;
        await redisCommand(['SET', ROUND_KEY, JSON.stringify(round)]);
      } else {
        const latestRaw = await redisCommand(['GET', ROUND_KEY]);
        if (latestRaw) round = JSON.parse(latestRaw);
      }
    }
    if (!round) return res.status(503).json({ ok:false, error:'ROUND_NOT_READY' });
    const historyRaw = await redisCommand(['GET', HISTORY_KEY]);
    const history = historyRaw ? JSON.parse(historyRaw) : [];
    const now2 = Date.now();
    const multiplier = round.phase === 'flight' ? Math.min(round.crashPoint, Math.exp(0.00012 * Math.max(0, now2 - round.startedAt))) : null;
    res.set('Cache-Control', 'no-store');
    return res.json({ ok:true, round:{ id:round.id, phase:round.phase, startedAt:round.startedAt, nextAt:round.nextAt, crashAt:round.crashAt, crashPoint:round.phase === 'flight' ? round.crashPoint : null, multiplier }, history });
  } catch (e) {
    const missing = e.message === 'SHARED_STORAGE_NOT_CONFIGURED';
    return res.status(missing ? 503 : 500).json({ ok:false, error: missing ? 'SHARED_STORAGE_NOT_CONFIGURED' : 'GAME_STATE_ERROR', message: missing ? 'Configure Upstash Redis REST URL and token in Render.' : 'Could not load shared game state.' });
  }
});
app.get('/game/health', (_req,res)=>res.json({ok:true,sharedStorageConfigured:!!(REDIS_URL&&REDIS_TOKEN),mode:'shared-demo-rounds'}));

app.listen(PORT,()=>console.log(`ZyloBet Telegram membership API listening on ${PORT}`));
