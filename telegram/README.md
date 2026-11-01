# News_ifxhelperbot interactive Telegram menu — isolated draft repair

**Scope**: read-only command + callback processing for existing `News_ifxhelper` Cloudflare Worker. Does not send orders, alter news alerts, modify credentials, create paid infrastructure, or perform production cutover.

## Commands and buttons

`/start`, `/menu` -> main menu; `/news` -> news freshness and link; `/calendar` -> Forex Factory current-week MYT event cards and High filter; `/bbma` -> timestamped historical BBMA snapshot and timeframe buttons; `/alerts` -> dashboard history link and honest delivery notes; `/health` -> last persisted health snapshot; `/help` -> help.

Every callback uses `ifx:v1:<action>` and is acknowledged with `answerCallbackQuery` then renders through `editMessageText`. URL buttons link to existing Pages. No false claims of real-time market prices.

## Verify on a branch

- `node --test test/telegram-menu-bot.test.mjs`
- `node --check telegram/menu-bot.mjs`
- `node --check telegram/register-menu.mjs`
- Existing `node test/cloudflare-worker.test.mjs` must remain green after Worker import and webhook route are added.
- Confirm no regressions in the existing Node CI suite on the PR head.

## Production cutover checklist (manual only)

1. Identify bot token with Telegram `getMe` and check it is `news_ifxhelperbot`.
2. Check current `getWebhookInfo`; do not replace another consumer without explicit owner-approved cutover. Telegram `getUpdates` and webhooks are mutually exclusive. Stop existing pollers for this token.
3. Set Cloudflare Worker **secret** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`; set `TELEGRAM_ALLOWED_CHAT_IDS` to a comma-separated numeric chat allowlist. Never put them in Git, Actions logs, or frontend bundles.
4. Deploy the already-tested Worker code using the existing **manual** deployment pipeline only after reviewing Free-tier usage and authorization. No automatic deployment in this change.
5. From a secure operator environment set `TELEGRAM_WEBHOOK_URL=https://<your-approved-host>/api/telegram/webhook`, `TELEGRAM_ALLOWED_CHAT_IDS`, and the Telegram token + secret; run `node telegram/register-menu.mjs` for a safe dry-run, then `node telegram/register-menu.mjs --apply` after approval.
6. Confirm `/start`, all callbacks, `/calendar`, `/bbma`, `/health`, links and unknown buttons in the real Telegram app. Confirm a live webhook response and chat identity; don't call a CI pass proof of live replies.
7. Check restart, network-failure retry and duplicate update delivery. Stateless handler does not guarantee exactly-once message delivery. For strict persistent deduplication use durable storage before broad rollout.

**Important**: Current news notifications use separate scheduled Actions. They remain unchanged. No runtime webhook is activated by this source package.
## Receipt hardening — source-only (1 Nov 2026)

New `telegram/update-receipts.mjs` supports optional D1 persistence with CAS lease epochs and duplicate-update suppression. All nine BBMA timeframe callbacks have buttons. Foreign-bot commands are ignored, and retrying a callback with an expired acknowledgment may recover safely. To require the ledger, initialize the schema in `telegram/receipts-schema.sql` on a **separately authorized** D1 database, bind it as `TELEGRAM_INBOX_DB`, and set `TELEGRAM_REQUIRE_INBOX=true`; otherwise this is an optional adapter, not deployed. Neither Cloudflare secrets nor bot token ownership are confirmed. Exactly-once Telegram sends cannot be guaranteed after ambiguous transport failures. Keep PR draft, no live cutover or billing changes.
