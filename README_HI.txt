ZyloBet Telegram Membership Backend — mobile setup guide

IMPORTANT:
- Never put the Telegram bot token inside index.html or send it in chat.
- The bot must be an administrator in the channel being checked.
- This starter backend verifies one configured Telegram channel using TELEGRAM_CHAT_ID.
- It does NOT yet read the channel link/member limit dynamically from your app's Admin Panel.
  That integration requires matching the exact Firestore structure and the frontend verification hook.
- A membership check needs the Telegram user's numeric ID from the Telegram WebApp session.
  Do not trust a user ID typed manually by the browser. Production deployment should validate
  Telegram WebApp initData server-side before treating the result as authoritative.

FILES:
- server.js
- package.json

RENDER SETTINGS:
- Runtime/Language: Node
- Build Command: npm install
- Start Command: npm start
- Instance: Free, if available on your account/region
- Environment Variables:
  TELEGRAM_BOT_TOKEN = your bot token (secret; keep private)
  TELEGRAM_CHAT_ID = channel ID, often -100... for a private/supergroup channel
  TELEGRAM_CHANNEL_LINK = public channel URL or invite link
  ALLOWED_ORIGIN = your app's exact website origin (recommended; avoid * in production)

DEPLOY:
1. Add server.js and package.json to the ROOT of the GitHub repository selected in Render.
2. Commit/save the files.
3. Return to Render and set Build Command to: npm install
4. Set Start Command to: npm start
5. Add the environment variables above in Render.
6. Deploy the service.
7. Open the service URL; the root should show a JSON health response.

Do not click deploy until server.js and package.json are committed to the selected repository.
The frontend index.html still needs to call POST /verify with the Telegram user's numeric ID and
use the response to show/hide the Join Channel screen. Do not assume the gate is live until that
frontend integration is added and tested.
