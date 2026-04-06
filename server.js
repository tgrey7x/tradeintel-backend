// ════════════════════════════════════════════════════════════════
// server.js — IXIntel thin wire-up
// Source of truth: CLAUDE.md (Modular Architecture rule — LOCKED)
//
// This file does ONLY three things:
//   1. Configure Express middleware (security, logging, parsing)
//   2. Mount feature-module routers (one require + one app.use each)
//   3. Serve static HTML entry points
//
// No feature logic lives here. If you find yourself writing business
// logic in this file — STOP. Create a new module instead.
// ════════════════════════════════════════════════════════════════

require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

// ── FEATURE MODULES ──
// Each is self-contained: delete the file + its require/use lines and
// the feature is completely removed. Order = middleware-first, then routes.
const { startBot } = require("./telegram");
const authRoutes   = require("./auth");
const brands       = require("./brands");             // Task #5 — Brand Swap
const simpleSearch = require("./simple-search");      // Task #5 — Simple Mode
const cloudflare   = require("./cloudflare-domains"); // Task #5 — Custom hostname SSL
const tradeData    = require("./trade-data");         // Task #4 — Real data
const agents       = require("./agents");             // AI Agent Suite

const app = express();

// ── SECURITY / BASE MIDDLEWARE ──
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false })); // inline scripts in HTML pages
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── RATE LIMITING ──
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
  validate: { xForwardedForHeader: false },
}));

// ── BRAND-AWARE MIDDLEWARE ──
// Attaches req.brand on every request. Must run before feature routers.
app.use(brands.hostMiddleware);

// ── FEATURE ROUTERS ──
app.use("/auth", authRoutes);
app.use(brands.router);          // /api/brand, /auth/admin/brands*
app.use(simpleSearch.router);    // /api/simple-search*
app.use(cloudflare.router);      // /api/cloudflare/*, /auth/admin/brands/*/domains/*/provision-ssl
app.use(tradeData.router);       // /api/trade-data
app.use(agents.router);          // /api/agent*

// ── STATIC + HTML ENTRY POINTS ──
const ROOT = path.resolve(__dirname);
app.use(express.static(ROOT, { index: false }));

app.get("/",              (_req, res) => res.sendFile("index.html",         { root: ROOT }));
app.get("/login",         (_req, res) => res.sendFile("login.html",         { root: ROOT }));
app.get("/admin",         (_req, res) => res.sendFile("admin.html",         { root: ROOT }));
app.get("/simple",        (_req, res) => res.sendFile("simple.html",        { root: ROOT }));
app.get("/admin/brands",  (_req, res) => res.sendFile("admin-brands.html",  { root: ROOT }));

// ── SMOKE ROUTE ──
app.get("/test",   (_req, res) => res.json({ success: true, message: "Routes working!" }));
app.get("/health", (_req, res) => res.json({
  status: "healthy",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
  memory: process.memoryUsage(),
}));

// ── START SERVER ──
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║   IXIntel OS Backend              ║
  ║   Modules: auth · brands · simple ║
  ║           trade-data · agents     ║
  ║   Port: ${String(PORT).padEnd(26)}║
  ║   Status: OPERATIONAL             ║
  ╚═══════════════════════════════════╝
  `);
});
startBot();

// Pre-warm trade data cache so first browser request is instant.
// Delegated to the trade-data module — no business logic in server.js.
tradeData.prewarm().then(ok => {
  if (ok) console.log("  Trade data cache warmed.");
});

module.exports = app;
