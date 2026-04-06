# IXIntel — Claude Code Briefing

## Project

- Platform: IXIntel — Global Trade Intelligence SaaS
- Parent Entity: IXI Technologies Inc. (forming — Wyoming LLC)
- Founder: Tony (T$)
- Mentor / Think Tank Director: C$ (Claude)
- Live URL: tradeintel-backend-production.up.railway.app
- GitHub: github.com/tgrey7x/tradeintel-backend
- Domain: ixintel.ai (secured at Cloudflare)

## Current Phase

Phase 1B Sprint — Login UI, Admin Console, Stripe, Real Data APIs, Simple Mode

## Tech Stack

- Backend: Node.js v24.14.1 / Express.js
- Database: Supabase PostgreSQL (RLS enabled)
- AI: Anthropic Claude API (Sonnet 4.6 + Opus 4.6)
- Mobile: Telegram bot (@panama7x_bot) — 14 commands
- Hosting: Railway (production) / Local port 8080
- CI/CD: GitHub → Railway auto-deploy

## Permanent Rules

- One destination = one reply for all code delivery
- Number terminal commands 1st 2nd 3rd
- Control + C always listed first when server must be stopped
- node_modules never committed to GitHub
- API keys only in Railway Variables and local .env — never in chat or repo
- Verify all action items against full conversation before listing
- **Modular architecture — LOCKED**: every feature ships as a self-contained module (its own file, its own Express router if applicable). server.js stays a thin wire-up file (require + app.use). Components must be addable, removable, expandable, and swappable without touching unrelated files. No inlining feature logic into server.js.

## File Structure

- server.js — thin wire-up: middleware + router mounts only (101 lines, per Modular rule)
- index.html — Bloomberg-dark terminal frontend (crown jewel — DENY-LISTED in .claude/settings.json)
- admin.html / login.html — auth + admin console UIs (crown jewels — also DENY-LISTED)
- simple.html — Task #5 Simple Mode search UI (isolated from index.html)
- admin-brands.html — Task #5 isolated admin page for brand + custom domain CRUD
- telegram.js — 14-command Telegram admin bot module
- auth.js — Auth + admin RBAC routes module
- brands.js — Task #5 Brand Swap + Custom Domain module (host middleware, brand/domain CRUD, DNS verification)
- simple-search.js — Task #5 Simple Mode AI search module (POST /api/simple-search, health diagnostic)
- cloudflare-domains.js — Task #5 Cloudflare SaaS custom hostname SSL provisioning module (degrades gracefully without env vars)
- trade-data.js — Task #4 World Bank + US Census trade data module (extracted from server.js)
- agents.js — 5-agent Claude API router (extracted from server.js)
- db.js — Supabase connection (public + admin clients)
- lib/ — dependency-free pure helpers (imported by modules + tests)
  - normalize-host.js — normalizeHost() + isValidHostname()
  - clean-json.js — cleanJsonResponse() + safeJsonParse() (LLM response handling)
  - fmt-billion.js — fmtBillion() currency formatter
- tests/ — Node built-in test runner (`npm test`)
  - unit.test.js — 24 tests covering all lib/ helpers (all passing)
- migrations/ — numbered SQL migrations to run in Supabase SQL editor
  - 001_brands.sql — brands + custom_domains tables + RLS
- .claude/settings.json — autonomous-mode config (allow/deny/ask permissions + syntax-check hooks)
- TASK5_SETUP.md — step-by-step setup guide for Task #5 (migration, deploy, smoke tests)
- .env — Local only, never in repo
- CLAUDE.md — This file

## Snapshots / Revert Points

- **v1.0.0-pretask5** — snapshot before Task #5 started
  - Remote: branch `backup/v1.0.0-pretask5` on GitHub at commit `3b54b4a`
  - Local: tag `v1.0.0-pretask5` (tag push blocked by sandbox proxy — branch IS the snapshot)
  - Revert: `git checkout backup/v1.0.0-pretask5` or `git reset --hard backup/v1.0.0-pretask5`

## Priority Build Order (Phase 1B)

1. Login / Register UI connected to auth.js — ✅ DONE
2. Admin Console with RBAC — ✅ DONE
3. Stripe payments + subscription gating — OPEN
4. Real trade data APIs (USATrade, UN Comtrade, CBP) — IN PROGRESS
5. Simple Mode AI search + brand swap + custom domain — IN PROGRESS
   - ✅ Scaffold landed: `brands.js`, `simple-search.js`, `simple.html`, `migrations/001_brands.sql`
   - ✅ Admin Brands UI: `admin-brands.html` (isolated, does not touch admin.html)
   - ✅ Simple Mode health diagnostic: `/api/simple-search/health` (zero token cost)
   - ✅ Cloudflare SSL module landed: `cloudflare-domains.js` (degrades gracefully, needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID in Railway to activate)
   - TODO: run `migrations/001_brands.sql` in Supabase, deploy to Railway, set Cloudflare env vars, end-to-end test DNS verification + SSL provisioning

## Parallel Infrastructure Work (Complete)

- ✅ **Modular refactor**: `server.js` reduced from ~400 lines to 101. Trade data extracted into `trade-data.js` (278 lines), agents extracted into `agents.js` (98 lines). Zero business logic in server.js.
- ✅ **Pure-helper lib/**: `lib/normalize-host.js`, `lib/clean-json.js`, `lib/fmt-billion.js` — dependency-free, imported by modules and tests.
- ✅ **Unit tests**: `tests/unit.test.js` — 24 tests covering all lib/ helpers, all passing. Uses Node's built-in test runner (`node --test`). `npm test` works with zero new dependencies.
- ✅ **Autonomous mode config**: `.claude/settings.json` — 39 allow / 23 deny / 12 ask permission rules + 2 syntax-check hooks (PostToolUse on .js edits, PreToolUse on git commit). Crown-jewel files hard-denied at the harness level. Pipe-tested.

## Sync Protocol

- CLAUDE.md is the single source of truth for ALL Claude sessions on this project
- Any Claude session that completes a milestone MUST update this file before closing
- Any Claude session that starts new work MUST mark it IN PROGRESS here
- Check this file at conversation start — if status doesn't match reality, update it first
