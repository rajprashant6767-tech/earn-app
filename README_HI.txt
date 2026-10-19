ZyloBet Rocket Crash shared demo rounds

Files: index.html, server.js, package.json. Existing Telegram channel verification endpoints remain in server.js.

Render environment variables required for Redis:
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN

The embedded Rocket Crash demo now polls GET https://zylobet-telegram-backend.onrender.com/game/state and uses the server-provided round id, phase, timestamps, multiplier, and crash point for shared visual synchronization. The demo's virtual balance and local cash-out UI are still client-side only; this is NOT an authoritative multiplayer wallet or server-side bet system. Do not use for real money, deposits, or withdrawals.

Deploy the updated server.js and index.html to their existing locations. Keep the same Render environment variables. Then open the app on two devices and compare the round id, countdown/flight phase, and multiplier at the same time.

Test the backend route directly: /game/health and /game/state. Health only reports configured env vars; /game/state verifies Redis commands work.
