const express = require("express");
const app = express();
app.use(express.json({ limit: "20kb" }));
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHANNEL_LINK = process.env.TELEGRAM_CHANNEL_LINK || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (_req, res) =>
  res.json({ ok: true, service: "ZyloBet Telegram membership API" })
);

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";

app.get("/supabase/health", async (_req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({
      ok: false,
      connected: false,
      error: "SUPABASE_ENV_MISSING"
    });
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/firestore_documents?select=id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      console.error("Supabase error:", response.status, await response.text());
      return res.status(502).json({
        ok: false,
        connected: false,
        error: "SUPABASE_CONNECTION_FAILED",
        status: response.status
      });
    }

    return res.json({
      ok: true,
      connected: true,
      database: "supabase"
    });
  } catch (error) {
    console.error("Supabase error:", error.message);
    return res.status(502).json({
      ok: false,
      connected: false,
      error: "SUPABASE_CONNECTION_FAILED"
    });
  }
});

// Telegram WebApp authentication
const crypto = require("crypto");

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) {
    throw Object.assign(new Error("TELEGRAM_BOT_TOKEN_MISSING"), { status: 503 });
  }

  if (typeof initData !== "string" || !initData || initData.length > 10000) {
    throw Object.assign(new Error("INVALID_INIT_DATA"), { status: 401 });
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw Object.assign(new Error("INVALID_INIT_DATA"), { status: 401 });
  }

  params.delete("hash");

  const check = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const expected = crypto
    .createHmac("sha256", secret)
    .update(check)
    .digest("hex");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(expected, "hex")
    )
  ) {
    throw Object.assign(new Error("TELEGRAM_AUTH_FAILED"), { status: 401 });
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) {
    throw Object.assign(new Error("TELEGRAM_AUTH_EXPIRED"), { status: 401 });
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch (_) {}

  if (!user || !/^\d{1,20}$/.test(String(user.id || ""))) {
    throw Object.assign(new Error("TELEGRAM_USER_MISSING"), { status: 401 });
  }

  return user;
}

function requireTelegramUser(req, res, next) {
  try {
    req.telegramUser = verifyTelegramInitData(
      req.body && req.body.initData
    );
    next();
  } catch (e) {
    res.status(e.status || 401).json({
      ok: false,
      error: e.message
    });
  }
}

async function supabaseRpc(name, body) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw Object.assign(new Error("SUPABASE_ENV_MISSING"), { status: 503 });
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const t = await r.text();

  if (!r.ok) {
    console.error("Supabase RPC", name, r.status, t.slice(0, 500));
    throw Object.assign(new Error("SUPABASE_RPC_FAILED"), { status: 502 });
  }

  return t ? JSON.parse(t) : null;
}

// Create a Supabase account on first Telegram login, or return the existing account.
// Coins and diamonds are intentionally omitted from the upsert so an existing balance
// can never be overwritten by the welcome defaults.
app.post("/api/account/bootstrap", requireTelegramUser, async (req, res) => {
  try {
    const user = req.telegramUser;
    const payload = {
      telegram_id: String(user.id),
      username: typeof user.username === "string" ? user.username : null,
      display_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null
    };

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/zylobet_users?on_conflict=telegram_id&select=telegram_id,username,display_name,coins,diamonds,daily_streak_day,daily_streak_last_claim_date`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(payload)
      }
    );

    const raw = await response.text();
    if (!response.ok) {
      console.error("Account bootstrap Supabase error:", response.status, raw.slice(0, 500));
      return res.status(502).json({ ok: false, error: "ACCOUNT_BOOTSTRAP_FAILED" });
    }

    const rows = raw ? JSON.parse(raw) : [];
    const account = Array.isArray(rows) ? rows[0] : rows;
    if (!account) return res.status(502).json({ ok: false, error: "ACCOUNT_NOT_RETURNED" });

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, account });
  } catch (e) {
    console.error("Account bootstrap failed:", e.message);
    return res.status(e.status || 502).json({ ok: false, error: "ACCOUNT_BOOTSTRAP_FAILED" });
  }
});

// Read the authenticated Telegram user's current Supabase wallet.
// This endpoint is read-only: clients cannot choose a user ID or change balances.
app.post("/api/wallet/balance", requireTelegramUser, async (req, res) => {
  try {
    const telegramId = String(req.telegramUser.id);
    const url = `${SUPABASE_URL}/rest/v1/zylobet_users?telegram_id=eq.${encodeURIComponent(telegramId)}&select=telegram_id,coins,diamonds,updated_at&limit=1`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        Accept: "application/json"
      }
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error("Wallet balance Supabase error:", response.status, raw.slice(0, 500));
      return res.status(502).json({ ok: false, error: "WALLET_READ_FAILED" });
    }

    const rows = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows) || !rows[0]) {
      return res.status(404).json({ ok: false, error: "ACCOUNT_NOT_FOUND" });
    }

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      telegramId: rows[0].telegram_id,
      coins: Number(rows[0].coins || 0),
      diamonds: Number(rows[0].diamonds || 0),
      updatedAt: rows[0].updated_at
    });
  } catch (e) {
    console.error("Wallet balance failed:", e.message);
    return res.status(502).json({ ok: false, error: "WALLET_READ_FAILED" });
  }
});

// Spend from the authenticated user's own wallet. Credits are intentionally NOT
// exposed through a client-controlled endpoint; rewards must be verified server-side.
const WALLET_DEBIT_PURPOSES = new Set([
  "rocket_crash_bet",
  "free_fire_entry",
  "coin_to_diamond_conversion"
]);

app.post("/api/wallet/debit", requireTelegramUser, async (req, res) => {
  try {
    const body = req.body || {};
    const purpose = String(body.purpose || "");
    const currency = String(body.currency || "");
    const amount = Number(body.amount);
    const requestKey = String(body.requestKey || "");

    if (!WALLET_DEBIT_PURPOSES.has(purpose)) {
      return res.status(400).json({ ok: false, error: "INVALID_WALLET_PURPOSE" });
    }
    if (!['coins', 'diamonds'].includes(currency) ||
        !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) {
      return res.status(400).json({ ok: false, error: "INVALID_WALLET_AMOUNT" });
    }
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestKey)) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST_KEY" });
    }

    const result = await supabaseRpc("apply_zylobet_wallet_transaction", {
      p_telegram_id: String(req.telegramUser.id),
      p_request_key: requestKey,
      p_action: "debit",
      p_currency: currency,
      p_amount: amount
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) throw new Error("EMPTY_RESULT");

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      purpose,
      transactionId: row.transaction_id,
      currency: row.currency,
      amount: Number(row.amount),
      balance: Number(row.balance_after),
      duplicate: Boolean(row.duplicate)
    });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("INSUFFICIENT_BALANCE")) {
      return res.status(409).json({ ok: false, error: "INSUFFICIENT_BALANCE" });
    }
    if (msg.includes("USER_NOT_FOUND")) {
      return res.status(404).json({ ok: false, error: "ACCOUNT_NOT_FOUND" });
    }
    if (msg.includes("REQUEST_KEY_CONFLICT")) {
      return res.status(409).json({ ok: false, error: "REQUEST_KEY_CONFLICT" });
    }
    console.error("Wallet debit failed:", msg);
    return res.status(e.status || 502).json({ ok: false, error: "WALLET_DEBIT_FAILED" });
  }
});

app.post("/api/referral/code", requireTelegramUser, async (req, res) => {
  try {
    const result = await supabaseRpc("get_or_create_zylobet_referral_code", {
      p_telegram_id: String(req.telegramUser.id)
    });
    const row = Array.isArray(result) ? result[0] : result;
    const code = String((row && (row.referral_code || row.code)) || "");
    if (!/^ZYL[A-F0-9]{8}$/.test(code)) throw new Error("INVALID_REFERRAL_CODE_RESULT");
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, code });
  } catch (e) {
    console.error("Referral code load failed:", e.message);
    return res.status(e.status || 502).json({ ok: false, error: "REFERRAL_CODE_FAILED" });
  }
});

app.post("/api/referral/status", requireTelegramUser, async (req, res) => {
  try {
    const telegramId = String(req.telegramUser.id);
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/zylobet_referrals?select=id&referred_telegram_id=eq.${encodeURIComponent(telegramId)}&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          Accept: "application/json"
        }
      }
    );
    if (!response.ok) {
      console.error("Referral status lookup failed:", response.status, (await response.text()).slice(0, 300));
      return res.status(502).json({ ok: false, error: "REFERRAL_STATUS_FAILED" });
    }
    const rows = await response.json();
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, redeemed: Array.isArray(rows) && rows.length > 0 });
  } catch (e) {
    console.error("Referral status error:", e.message);
    return res.status(502).json({ ok: false, error: "REFERRAL_STATUS_FAILED" });
  }
});

app.post("/api/referral/redeem", requireTelegramUser, async (req, res) => {
  try {
    const code = String((req.body && req.body.code) || "").trim().toUpperCase();
    if (!/^ZYL[A-F0-9]{8}$/.test(code)) {
      return res.status(400).json({ ok: false, error: "INVALID_REFERRAL" });
    }

    const result = await supabaseRpc("redeem_zylobet_referral", {
      p_referred_telegram_id: String(req.telegramUser.id),
      p_referral_code: code
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || row.ok !== true) throw new Error("EMPTY_RESULT");

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      reward: Number(row.reward),
      coins: Number(row.coins),
      referralId: row.referral_id
    });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("ALREADY_REDEEMED"))
      return res.status(409).json({ ok: false, error: "ALREADY_REDEEMED" });
    if (msg.includes("REFERRAL_NOT_FOUND"))
      return res.status(404).json({ ok: false, error: "REFERRAL_NOT_FOUND" });
    if (msg.includes("REFERRAL_CODE_AMBIGUOUS"))
      return res.status(409).json({ ok: false, error: "REFERRAL_CODE_AMBIGUOUS" });
    if (msg.includes("USER_NOT_FOUND"))
      return res.status(404).json({ ok: false, error: "ACCOUNT_NOT_FOUND" });
    console.error("Referral redemption failed:", msg);
    return res.status(e.status || 502).json({ ok: false, error: "REFERRAL_REDEEM_FAILED" });
  }
});

app.post("/api/daily-streak/claim", requireTelegramUser, async (req, res) => {
  try {
    const result = await supabaseRpc(
      "claim_zylobet_daily_streak",
      { p_telegram_id: String(req.telegramUser.id) }
    );

    const row = Array.isArray(result) ? result[0] : result;

    if (!row) throw new Error("EMPTY_RESULT");

    return res.json({
      ok: true,
      day: Number(row.day),
      reward: Number(row.reward),
      claimDate: row.claim_date,
      coins: Number(row.coins),
      diamonds: Number(row.diamonds),
      transactionId: row.transaction_id
    });
  } catch (e) {
    const msg = String(e.message || "");

    if (msg.includes("ALREADY_CLAIMED")) {
      return res.status(409).json({
        ok: false,
        error: "ALREADY_CLAIMED"
      });
    }

    console.error("Daily streak claim failed:", msg);

    return res.status(e.status || 502).json({
      ok: false,
      error: "DAILY_STREAK_CLAIM_FAILED"
    });
  }
});

app.get("/config", (_req, res) =>
  res.json({ channelLink: CHANNEL_LINK })
);

function getChatIdFromLink(link) {
  try {
    const u = new URL(link);

    if (!["t.me", "www.t.me"].includes(u.hostname.toLowerCase())) {
      return null;
    }

    const slug = u.pathname.split("/").filter(Boolean)[0];

    if (!slug || slug === "s" || slug === "c" || slug.startsWith("+")) {
      return null;
    }

    return "@" + slug;
  } catch {
    return null;
  }
}

async function telegram(method, body) {
  const r = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  return { http: r.status, data: await r.json() };
}

app.get("/channel-info", async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      return res.status(503).json({ ok: false, error: "SERVER_NOT_CONFIGURED" });
    }

    const link = String(req.query.link || CHANNEL_LINK);
    const chatId = getChatIdFromLink(link);

    if (!chatId) {
      return res.status(400).json({ ok: false, error: "INVALID_PUBLIC_CHANNEL_LINK" });
    }

    const out = await telegram("getChat", { chat_id: chatId });

    if (!out.data.ok) {
      return res.status(502).json({
        ok: false,
        error: "TELEGRAM_GET_CHAT_FAILED",
        message: "Confirm this is a public channel and the bot can access it."
      });
    }

    const chat = out.data.result;
    let photoUrl = "";

    if (chat.photo && chat.photo.big_file_id) {
      photoUrl = `${req.protocol}://${req.get("host")}/channel-photo?link=${encodeURIComponent(link)}`;
    }

    return res.json({
      ok: true,
      title: chat.title || chat.username || "Telegram Channel",
      username: chat.username || "",
      photoUrl
    });
  } catch (e) {
    console.error("Channel info error:", e);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

app.get("/channel-photo", async (req, res) => {
  try {
    if (!BOT_TOKEN) return res.sendStatus(503);

    const link = String(req.query.link || CHANNEL_LINK);
    const chatId = getChatIdFromLink(link);

    if (!chatId) return res.sendStatus(400);

    const c = await telegram("getChat", { chat_id: chatId });

    if (!c.data.ok || !c.data.result.photo) return res.sendStatus(404);

    const photo = c.data.result.photo;
    const fileId = photo.big_file_id || photo.small_file_id;

    if (!fileId) return res.sendStatus(404);

    const f = await telegram("getFile", { file_id: fileId });

    if (!f.data.ok || !f.data.result.file_path) return res.sendStatus(404);

    const img = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${f.data.result.file_path}`
    );

    if (!img.ok) return res.sendStatus(502);

    res.setHeader("Content-Type", img.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=300");

    return res.send(Buffer.from(await img.arrayBuffer()));
  } catch (e) {
    console.error("Channel photo error:", e);
    return res.sendStatus(500);
  }
});

app.post("/verify", async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      return res.status(503).json({
        ok: false,
        error: "SERVER_NOT_CONFIGURED",
        message: "Set TELEGRAM_BOT_TOKEN in Render environment variables."
      });
    }

    const userId = String(req.body && req.body.telegramUserId || "").trim();

    if (!/^\d{1,20}$/.test(userId)) {
      return res.status(400).json({ ok: false, error: "INVALID_TELEGRAM_USER_ID" });
    }

    const requestedLink = String(req.body && req.body.channelLink || "").trim();
    const dynamicChatId = requestedLink ? getChatIdFromLink(requestedLink) : null;
    const chatId = dynamicChatId || CHAT_ID;

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_CHANNEL_LINK",
        message: "Pass a valid public channel link."
      });
    }

    const out = await telegram("getChatMember", {
      chat_id: chatId,
      user_id: userId
    });

    if (!out.data.ok) {
      return res.status(502).json({
        ok: false,
        error: "TELEGRAM_CHECK_FAILED",
        message: "Could not check membership. Confirm the bot is an administrator and TELEGRAM_CHAT_ID is correct."
      });
    }

    const status = out.data.result && out.data.result.status;
    const isMember =
      ["creator", "administrator", "member"].includes(status) ||
      (status === "restricted" && out.data.result.is_member === true);

    return res.json({
      ok: true,
      isMember,
      status,
      channelLink: requestedLink || CHANNEL_LINK
    });
  } catch (e) {
    console.error("Membership verification error:", e);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

// Rocket Crash shared state - Redis
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

async function redisCommand(command) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("SHARED_STORAGE_NOT_CONFIGURED");
  }

  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const j = await r.json();

  if (!r.ok || j.error) throw new Error("REDIS_COMMAND_FAILED");

  return j.result;
}

const ROUND_KEY = "zylobet:rocket:round:v2";
const HISTORY_KEY = "zylobet:rocket:history:v2";

function makeCrashPoint() {
  const u = Math.max(0.000001, Math.random());
  return Math.max(1.01, Math.min(30, Math.floor((1 / u) * 100) / 100));
}

const ADVANCE_ROUND_SCRIPT = `
local roundKey = KEYS[1]
local historyKey = KEYS[2]
local now = tonumber(ARGV[1])
local candidateCrashPoint = tonumber(ARGV[2])
local raw = redis.call('GET', roundKey)
local round = nil
if raw then round = cjson.decode(raw) end

if not round then
  round = {id=1, phase='countdown', startedAt=now, nextAt=now+10000, crashAt=cjson.null, crashPoint=cjson.null}
elseif round.phase == 'countdown' and now >= tonumber(round.nextAt) then
  local cp = candidateCrashPoint
  local duration = math.log(math.max(1.01, cp)) / 0.00012
  round = {id=tonumber(round.id)+1, phase='flight', startedAt=now, nextAt=cjson.null, crashAt=now+duration, crashPoint=cp}
elseif round.phase == 'flight' and now >= tonumber(round.crashAt) then
  local histRaw = redis.call('GET', historyKey)
  local history = {}
  if histRaw then history = cjson.decode(histRaw) end
  table.insert(history, 1, {id=tonumber(round.id), crashPoint=tonumber(round.crashPoint), endedAt=now})
  while #history > 10 do table.remove(history) end
  redis.call('SET', historyKey, cjson.encode(history))
  round = {id=tonumber(round.id), phase='crash', startedAt=now, nextAt=now+2400, crashAt=now, crashPoint=tonumber(round.crashPoint)}
elseif round.phase == 'crash' and now >= tonumber(round.nextAt) then
  round = {id=tonumber(round.id), phase='countdown', startedAt=now, nextAt=now+7600, crashAt=cjson.null, crashPoint=cjson.null}
end

redis.call('SET', roundKey, cjson.encode(round))
return cjson.encode(round)
`;

app.get("/game/state", async (_req, res) => {
  try {
    const now = Date.now();
    const candidateCrashPoint = makeCrashPoint();

    const rawRound = await redisCommand([
      "EVAL",
      ADVANCE_ROUND_SCRIPT,
      "2",
      ROUND_KEY,
      HISTORY_KEY,
      String(now),
      String(candidateCrashPoint)
    ]);

    const round = typeof rawRound === "string" ? JSON.parse(rawRound) : rawRound;
    const historyRaw = await redisCommand(["GET", HISTORY_KEY]);
    const history = historyRaw ? JSON.parse(historyRaw) : [];
    const now2 = Date.now();

    const multiplier = round.phase === "flight"
      ? Math.min(
          Number(round.crashPoint),
          Math.exp(0.00012 * Math.max(0, now2 - Number(round.startedAt)))
        )
      : null;

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.json({
      ok: true,
      serverTime: now2,
      round: {
        id: Number(round.id),
        phase: round.phase,
        startedAt: Number(round.startedAt),
        nextAt: round.nextAt == null ? null : Number(round.nextAt),
        crashAt: round.crashAt == null ? null : Number(round.crashAt),
        crashPoint:
          round.phase === "flight" || round.phase === "crash"
            ? Number(round.crashPoint)
            : null,
        multiplier
      },
      history
    });
  } catch (e) {
    console.error("Shared game state error:", e && e.message ? e.message : e);

    const missing = e.message === "SHARED_STORAGE_NOT_CONFIGURED";

    return res.status(missing ? 503 : 500).json({
      ok: false,
      error: missing ? "SHARED_STORAGE_NOT_CONFIGURED" : "GAME_STATE_ERROR",
      message: missing
        ? "Configure Upstash Redis REST URL and token in Render."
        : "Could not load shared game state."
    });
  }
});

app.get("/game/health", (_req, res) =>
  res.json({
    ok: true,
    sharedStorageConfigured: !!(REDIS_URL && REDIS_TOKEN),
    mode: "shared-demo-rounds"
  })
);

app.listen(PORT, () =>
  console.log(`ZyloBet Telegram membership API listening on ${PORT}`)
);
