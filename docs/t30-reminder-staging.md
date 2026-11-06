# T−30 Cloudflare reminders — staging only
This branch does not deploy, enable billing, create secrets, or change the live Worker.
Existing Worker name in wrangler.toml: gentle-violet-4a79. Its live cron schedule was empty when audited.
Run locally: node test/t30-reminder.test.mjs
Apply migrations/001_reminder_delivery.sql to a separately provisioned D1 database, bind it as REMINDER_DB, configure TELEGRAM_BOT_TOKEN (secret), TELEGRAM_CHAT_ID and optionally TELEGRAM_CHANNEL_ID.
Integrate runReminders into the Worker scheduled() handler and configure cron '*/5 * * * *' only after explicit approval and verified D1/Telegram permissions.
The feed is Forex Factory's current-week data. Investing.com is not integrated because a reliable authorized machine-readable feed was not verified.
Reminder window is >25 and <=30 minutes before the event; cron delay can cause missed reminders. Do not claim exact-minute guarantees.
Telegram ambiguous failures can produce duplicates after lease expiry; message acknowledgement is not transactional with D1. Monitor 'uncertain' rows before production enablement.
