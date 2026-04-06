# Contributing To SilentCart

Thanks for considering a contribution.

SilentCart is intentionally small, privacy-focused, and Monero-first. The best contributions keep that direction intact instead of widening scope for convenience.

## Before You Start

- Read the README to understand the product boundaries
- Check existing issues or notes before starting a large change
- Prefer opening a small design discussion before major behavior changes

## Project Guardrails

Please preserve these decisions unless there is a strong reason and a clear migration path:

- Monero only in v1
- no custodial wallet behavior
- no spend key requirement
- no web admin panel
- minimal Telegram data retention
- no unnecessary profile-field storage
- Telegram admin access only for allowlisted users in private chat

## Local Setup

```bash
npm install
npm run migrate:up
npm run dev
```

If you want the full container setup:

```bash
docker compose up --build
```

## Required Checks

Run these before opening a PR or sharing a patch:

```bash
npm run ci
```

If you add database changes, also create a migration:

```bash
npm run migrate:create -- describe change
```

## Coding Standards

- Keep code, comments, docs, and commit messages in English
- Prefer small, composable services over large handler files with hidden state
- Treat Telegram input and callback data as untrusted
- Keep fulfillment and payment processing idempotent
- Never log license keys, download secrets, private links, or plaintext payloads
- Keep XMR primary in both data modeling and UX
- Preserve privacy defaults when adding features

## Tests

Add or update tests for any behavior change affecting:

- order state transitions
- pricing or quote freezing
- admin authorization
- fulfillment logic
- retention purge rules
- license-stock reservation or consumption

Integration tests are especially valuable when a change spans ordering, payment detection, and delivery.

## Documentation

If a behavior change affects operators or buyers, update the README and any related policy text in the bot.

## Security Issues

Please do not open public issues for security-sensitive bugs. Follow the process in [SECURITY.md](SECURITY.md).
