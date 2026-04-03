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

Phase 1B Sprint — Login UI, Admin Console, Stripe, Real Data APIs

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

## File Structure

- server.js — Express server, routes, middleware, all 5 agents
- index.html — Bloomberg-dark frontend (mock data)
- telegram.js — 14-command Telegram admin bot
- auth.js — Auth routes (backend live — UI needed)
- db.js — Supabase connection
- .env — Local only, never in repo
- CLAUDE.md — This file

## Priority Build Order (Phase 1B)

1. Login / Register UI connected to auth.js
2. Admin Console with RBAC
3. Stripe payments + subscription gating
4. Real trade data APIs (USATrade, UN Comtrade, CBP)
5. Simple Mode AI search + brand swap + custom domain
