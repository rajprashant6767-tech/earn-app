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

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "ZyloBet Telegram membership API" });
});

app.get("/config", (_req, res) => {
  res.json({ channelLink: CHANNEL_LINK });
});

app.post("/verify", async (req, res) => {
  try {
    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(503).json({
        ok: false,
        error: "SERVER_NOT_CONFIGURED",
        message: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Render environment variables."
      });
    }

    const userId = String(req.body && req.body.telegramUserId || "").trim();
    if (!/^\d{1,20}$/.test(userId)) {
      return res.status(400).json({ ok: false, error: "INVALID_TELEGRAM_USER_ID" });
    }

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
    const tgResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, user_id: userId })
    });

    const result = await tgResponse.json();
    if (!tgResponse.ok || !result.ok) {
      console.error("Telegram getChatMember failed:", result && result.description);
      return res.status(502).json({
        ok: false,
        error: "TELEGRAM_CHECK_FAILED",
        message: "Could not check membership. Confirm the bot is an administrator and TELEGRAM_CHAT_ID is correct."
      });
    }

    const status = result.result && result.result.status;
    const isMember = ["creator", "administrator", "member"].includes(status) ||
      (status === "restricted" && result.result.is_member === true);

    return res.json({
      ok: true,
      isMember,
      status,
      channelLink: CHANNEL_LINK
    });
  } catch (error) {
    console.error("Membership verification error:", error);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

app.listen(PORT, () => {
  console.log(`ZyloBet Telegram membership API listening on ${PORT}`);
});