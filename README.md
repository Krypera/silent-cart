# SilentCart

SilentCart is an open-source, self-hosted Telegram bot for selling digital products with Monero only.

It is built for privacy-focused solo operators who want a Telegram-native checkout and delivery flow without a web admin panel, without custodial wallet behavior, and without unnecessary user-data retention.

## Why SilentCart

SilentCart is opinionated on purpose.

- Monero is the only payment rail in v1.
- Telegram is both the storefront and the admin console.
- The bot never spends funds and does not require a spend key.
- The system stores only the minimum Telegram identity link needed for delivery and temporary re-delivery.
- Historical order records survive after the user link is purged.

This is a small, sharp tool for digital fulfillment, not a generic ecommerce platform.

## Who It Is For

- Solo creators selling files, codes, links, or license keys
- Small digital product operators who want a simple self-hosted checkout flow
- Privacy-focused sellers who do not want a web admin panel
- Monero supporters who want XMR to stay primary in both UX and settlement

## What Ships In This Repo

- Telegram customer flow for browsing, buying, and re-delivery
- Automatic customer messages when payment is seen, confirmed, underpaid, or expired
- Telegram admin flow for product management, stock, wallet health, and stats
- Paged admin catalog and order views with quick filters for live order states
- Restart-safe admin drafts so guided product and stock flows survive bot restarts
- Operator alerts for scan failures, partial scan issues, stale scans, wallet-rpc outages, daemon sync issues, and manual-review orders
- Monero wallet-rpc payment detection with unique payment targets per order
- Product snapshots that preserve historical fulfillment even after product edits
- Quote freezing for both fixed-XMR and USD-anchored pricing
- Idempotent fulfillment and duplicate-payment protection
- License-key reservation, release, and final consumption under concurrency
- Payload encryption at rest for text, links, files, and stock secrets
- Retention-link purging so re-delivery ends when the privacy window closes
- Background workers for payment scans, confirmations, expiration, retries, and retention cleanup

## Core Product Principles

- Monero-first: XMR is the settlement currency. USD is optional and secondary.
- Non-custodial: SilentCart detects incoming payments only. It never transfers funds.
- Telegram-native: No web admin panel in v1.
- Minimal retention: No username, first name, or last name storage.
- Reliable delivery: Paid orders should be fulfilled once, clearly, and recoverably.

## Supported Product Types

- File delivery
- Text/code delivery
- Download link delivery
- License key delivery

## Supported Pricing Modes

- Fixed XMR
- USD-anchored with quote freezing at order creation

SilentCart always settles in Monero. If USD is shown, it is reference-only.

## Customer Flow

```mermaid
flowchart TD
    A["/start"] --> B["Browse active products"]
    B --> C["Open product detail"]
    C --> D["Buy with Monero"]
    D --> E["Create order + unique payment target"]
    E --> F["Show XMR amount, address, QR, expiry, payment policy"]
    F --> G["Customer pays in XMR"]
    G --> H["Payment scan sees transaction"]
    H --> I["1 confirmation reached"]
    I --> J["Fulfillment engine delivers product"]
    J --> K["Receipt + retention notice + temporary re-delivery window"]
```

## Admin Flow

SilentCart keeps operator work inside a Telegram private chat.

- `/admin` shows a compact operator dashboard
- `/addproduct` starts a guided creation wizard
- `/products` lists catalog items in pages with edit and activate/deactivate controls
- `/orders` lists recent orders in pages with quick state filters and eligible recovery actions
- `/findorder <query>` searches orders by order ID, tx hash, or product title hint
- `/stock` shows license inventory and lets admins add keys safely
- `/findproduct <query>` searches products by title or product ID
- `/wallet` shows wallet-rpc reachability, scan freshness, sync hints, and recent detections
- `/stats` shows lightweight sales counters
- `/settings` shows retention settings and lets the seller edit the custom "Why I accept Monero" message
- `/cancel` stops any in-progress admin flow cleanly
- `/recover <order-id>` runs an automatic recovery action for eligible orders
- Guided admin drafts persist in PostgreSQL, so a restart does not silently discard an in-progress operator action

Customer helpers:

- `/checkout` lists open unpaid or in-progress checkouts so a buyer can reopen payment instructions
- `/deliveries` lists eligible re-deliveries while the temporary Telegram link still exists

## Architecture Overview

The codebase stays modular so the Monero adapter, fulfillment logic, retention rules, and Telegram UX can evolve independently.

- `src/bot`: customer/admin Telegram handlers, persistent admin-draft middleware, delivery messenger
- `src/services`: catalog, pricing, orders, payments, retention, guide, health, stats
- `src/services/fulfillment`: idempotent delivery engine
- `src/monero`: wallet-rpc and monerod adapters
- `src/repositories`: Postgres and in-memory store implementations, split by domain repository
- `src/db`: database client, migration runner, migration generator, SQL migrations
- `src/workers`: background task loops for scans, expiry, retries, retention purge, and advisory-lock coordination

### Order State Model

- `created`
- `awaiting_payment`
- `payment_seen`
- `confirmed`
- `fulfilled`
- `underpaid`
- `expired`
- `purged`

Rules:

- Exact payment fulfills after 1 confirmation
- Overpayment fulfills after 1 confirmation and is not refunded
- Underpayment never fulfills and is not refunded
- Partial payments are not aggregated in v1
- A later standalone qualifying payment can still be accepted while the quote is still open
- Duplicate payment events must never create duplicate fulfillment

## Privacy And Retention

SilentCart intentionally separates anonymous operational order data from the temporary Telegram identity link used for delivery.

Anonymous records may keep:

- order ID
- product snapshot
- quoted XMR amount
- optional USD reference snapshot
- payment reference or tx hash
- order, payment, and fulfillment state
- timestamps

Temporary linkage keeps only what is needed to deliver the purchase and support re-delivery for a limited time.

By default:

- Telegram identity linkage is retained for 30 days after fulfillment
- after that window, the link is severed
- re-delivery stops because the bot can no longer prove ownership
- anonymous historical order data remains for operations and audits

## Monero Wallet Model

SilentCart is designed for a detection-only integration.

- Preferred deployment: watch-only wallet-rpc
- Spend key: not required and not used
- Unique payment target: one per order
- Expected RPC methods: `create_address`, `refresh`, `get_transfers`, `get_height`, `get_version`
- Optional monerod health checks: `get_info`

If something cannot be done safely with a watch-only or detection-only model, it is out of scope for v1.

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker and Docker Compose
- PostgreSQL if running locally without Compose
- A Telegram bot token from BotFather
- A Monero wallet-rpc endpoint configured for detection

### 2. Configure Environment

Copy the example file:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Set at least:

- `BOT_TOKEN`
- `ADMIN_TELEGRAM_USER_IDS`
- `DATABASE_URL`
- `FULFILLMENT_ENCRYPTION_KEY`
- `XMR_WALLET_RPC_URL`
- `XMR_ACCOUNT_INDEX`

You can generate a fresh encryption key with:

```bash
npm run ops:generate-key
```

If you want a quick end-to-end test catalog in a fresh deployment, you can add sample products with:

```bash
npm run ops:seed-demo
```

The seed command is intentionally conservative. It skips itself when products already exist unless `DEMO_SEED_FORCE=true` is set.

Optional but recommended:

- `MONEROD_RPC_URL`
- `USD_REFERENCE_ENABLED`
- `WALLET_HEALTH_CHECK_INTERVAL_MS`
- `WALLET_STALE_SCAN_ALERT_MS`
- `TELEGRAM_RETRY_ATTEMPTS`
- `OPERATOR_ALERT_COOLDOWN_MS`

### 3. Run With Docker Compose

```bash
docker compose up --build
```

The container runs migrations before the bot starts.

### 4. Run Locally

```bash
npm install
npm run migrate:up
npm run dev
```

## Development Workflow

### Run checks

```bash
npm run ci
```

### Run an operator preflight check

After `.env` is configured, you can inspect the deployment with:

```bash
npm run ops:doctor
```

This checks database reachability, migration status, admin sync visibility, wallet-rpc connectivity, daemon sync status, and current scan counters. It exits with a non-zero code when the deployment still needs operator attention.

### Seed a demo catalog

If you want to test the Telegram buyer flow on a brand-new instance, you can insert two sample products:

```bash
npm run ops:seed-demo
```

This is useful right after migrations and before creating your real catalog.

### Export an encrypted operational backup

To export an encrypted backup of operational records:

```bash
npm run ops:backup:export
```

By default this keeps `telegram_user_id` redacted in retention links and writes an encrypted file under `backups/`.

Optional environment flags:

- `BACKUP_INCLUDE_IDENTITY_LINKS=true` to include raw identity links
- `BACKUP_EXPORT_KEY=<64-hex-key>` to use a dedicated backup key instead of `FULFILLMENT_ENCRYPTION_KEY`
- `BACKUP_EXPORT_OUTPUT_DIR=<path>` to change output location

### Run Postgres smoke tests

If you have a disposable PostgreSQL database for integration checks, you can run the real-store smoke suite with:

```bash
TEST_DATABASE_URL=postgres://silentcart:silentcart@localhost:5432/silentcart_test npm run test:postgres
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgres://silentcart:silentcart@localhost:5432/silentcart_test"
npm run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

The test file applies migrations automatically and skips itself when `TEST_DATABASE_URL` is not set.

### Create a new migration

```bash
npm run migrate:create -- add product tags
```

This creates a new numbered SQL file in `src/db/migrations`. Applied migrations are tracked in `schema_migrations` with checksums, so edited historical migrations are detected and rejected.

### Build production output

```bash
npm run build
```

### Rotate the fulfillment encryption key

SilentCart now ships with a re-encryption operation for stored payloads and license secrets.

Recommended sequence:

1. Back up the database.
2. Generate the new 64-character hex key.
3. Run a dry-run first:

```bash
REENCRYPTION_TARGET_KEY=<new-64-char-hex> npm run ops:reencrypt
```

PowerShell:

```powershell
$env:REENCRYPTION_TARGET_KEY = "<new-64-char-hex>"
npm run ops:reencrypt
Remove-Item Env:REENCRYPTION_TARGET_KEY
```

4. If the dry-run summary looks correct, apply it:

```bash
REENCRYPTION_TARGET_KEY=<new-64-char-hex> REENCRYPTION_APPLY=true npm run ops:reencrypt
```

PowerShell:

```powershell
$env:REENCRYPTION_TARGET_KEY = "<new-64-char-hex>"
$env:REENCRYPTION_APPLY = "true"
npm run ops:reencrypt
Remove-Item Env:REENCRYPTION_TARGET_KEY
Remove-Item Env:REENCRYPTION_APPLY
```

5. Update `FULFILLMENT_ENCRYPTION_KEY` in the deployment environment to the same new key and restart the app.

The command rewrites encrypted product payloads, order snapshots, and license stock secrets inside a single database transaction.

## Docker And Deployment Notes

- The Docker image is multi-stage and runs compiled JavaScript in production
- `docker-compose.yml` includes PostgreSQL and the app
- wallet-rpc and monerod infrastructure are expected to be provided by the operator
- on Linux hosts, `docker-compose.yml` maps `host.docker.internal` to `host-gateway` for wallet-rpc access
- `.dockerignore` keeps local noise out of published images

## Reliability Notes

- Telegram sends now use retry and backoff for temporary API and network failures
- Buyers receive automatic Telegram status updates when a payment is seen, confirmed, underpaid, or expired
- Admins receive Telegram alerts when payment scans fail, complete only partially, go stale while orders are pending, wallet-rpc becomes unreachable, monerod falls out of sync, or an order enters manual review
- Background workers coordinate through PostgreSQL advisory locks so only one replica runs each periodic job at a time
- Guided admin actions are mirrored into PostgreSQL-backed draft storage so bot restarts do not lose in-progress edits
- The repo includes a payload re-encryption command so operators can rotate the fulfillment encryption key deliberately instead of replacing it blindly
- The repo also includes `ops:doctor` and `ops:generate-key` commands for safer self-hosted operations
- The repo also includes `ops:seed-demo` for a fast non-production checkout smoke pass on fresh instances

## Testing

Current automated coverage includes:

- product creation and editing
- admin authorization
- quote freezing
- order state transitions
- underpaid and overpaid handling
- fulfillment by each product type
- re-delivery behavior
- retention purge behavior
- license-stock reservation and finalization
- order lifecycle integration
- duplicate-fulfillment prevention

Run tests with:

```bash
npm test
```

## Public Repo Checklist

This repo now includes the basic files expected from a public open-source project:

- [LICENSE](LICENSE)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- GitHub issue templates and a pull request template
- GitHub Actions CI in `.github/workflows/ci.yml`
- `.editorconfig` and `.gitattributes` for consistent cross-platform editing

You do not need a GitHub account today to keep these files in the repo. When you publish later, the project will already look and behave like a maintained public codebase.

## Roadmap

- richer admin editing flows and bulk inventory tooling
- configurable retention and quote timing from Telegram settings
- optional alternative exchange-rate providers
- better fulfillment recovery tooling for rare Telegram delivery edge cases
- encrypted export and backup tooling for anonymous operational records
- slimmer handler modules so bot flows are easier to maintain as the repo grows

## License

SilentCart is released under the MIT License. See [LICENSE](LICENSE).
