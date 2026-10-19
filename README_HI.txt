# ZyloBet Telegram backend + Rocket Crash shared-round API

## Included
- Existing Telegram membership verification and channel profile/photo routes preserved.
- `GET /game/health` reports whether shared Redis storage is configured.
- `GET /game/state` returns the shared countdown/flight round, current multiplier, crash point during flight, and recent history.
- Game state is stored in Upstash Redis so separate backend instances can read the same round.

## Render setup
1. Create a Redis database at Upstash and copy its **REST URL** and **REST token**.
2. In Render → your existing backend → Environment, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Keep existing `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (if used), `TELEGRAM_CHANNEL_LINK`, and `ALLOWED_ORIGIN` values unchanged. Never put these secrets in `index.html`.
4. Deploy `server.js` and `package.json`; Node 18+ is required.
5. Check `/game/health` and confirm `sharedStorageConfigured: true`, then `/game/state`.

## Important limitation
This backend supplies a common round clock/result feed, but the currently supplied embedded Rocket Crash HTML still runs its multiplier, bet deduction, and cash-out locally. It has **not** yet been wired to consume `/game/state`; therefore this package alone does not make the whole game synchronized or make balances authoritative. Do not describe it as fully live/multiplayer until frontend synchronization and server-side bet/cash-out validation are implemented and tested.

The round result is a demo-game result only. No real-money betting, deposits, or withdrawals are implemented here.
