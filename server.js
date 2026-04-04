require("dotenv").config();
const path = require("path");
const express = require("express");
const { startBot, sendAlert } = require("./telegram");
const authRoutes = require("./auth");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();

// ── SECURITY MIDDLEWARE ──
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── RATE LIMITING ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
  validate: { xForwardedForHeader: false },
});
app.use(limiter);

// ── ROUTES ──
app.use("/auth", authRoutes);
app.get("/test", (req, res) =>
  res.json({ success: true, message: "Routes working!" }),
);
const ROOT = path.resolve(__dirname);
app.use(express.static(ROOT, { index: false }));

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: ROOT });
});

app.get("/login", (req, res) => {
  res.sendFile("login.html", { root: ROOT });
});

app.get("/admin", (req, res) => {
  res.sendFile("admin.html", { root: ROOT });
});

// ── TRADE DATA ROUTE ──
// World Bank API — no key required
// GET /api/trade-data?country=US&flow=both&year=2024
const TRADE_CACHE = { data: null, ts: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const WB_COUNTRIES = "US;CN;DE;JP;IN;MX;CA;KR;GB;BR;VNM;SGP";
const WB_BASE = "https://api.worldbank.org/v2";

async function fetchWB(indicator, countries, mrv = 1) {
  const url = `${WB_BASE}/country/${countries}/indicator/${indicator}?format=json&mrv=${mrv}&per_page=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank API error: ${res.status}`);
  const json = await res.json();
  return json[1] || [];
}

app.get("/api/trade-data", async (req, res) => {
  try {
    const { country, flow, year } = req.query;
    const now = Date.now();

    // Refresh cache every 6 hours
    if (!TRADE_CACHE.data || now - TRADE_CACHE.ts > CACHE_TTL) {
      // mrv=3 gives current + 2 prior years — 2 calls to stay under rate limit
      const exportsHistRaw = await fetchWB("TX.VAL.MRCH.CD.WT", WB_COUNTRIES, 3);
      const importsHistRaw = await fetchWB("TM.VAL.MRCH.CD.WT", WB_COUNTRIES, 3);

      // Build per-country lookup
      const byCountry = {};
      const addRow = (rows, key) => {
        rows.forEach(r => {
          if (!r.value) return;
          const id = r.country.id;
          if (!byCountry[id]) byCountry[id] = { id, name: r.country.value };
          if (!byCountry[id][key]) byCountry[id][key] = {};
          byCountry[id][key][r.date] = r.value;
        });
      };
      addRow(exportsHistRaw, "exports");
      addRow(importsHistRaw, "imports");

      // Build ticker items from latest data
      const ticker = [];
      Object.values(byCountry).forEach(c => {
        const expYears = Object.keys(c.exports || {}).sort().reverse();
        const impYears = Object.keys(c.imports || {}).sort().reverse();
        if (expYears.length >= 2) {
          const cur = c.exports[expYears[0]];
          const prev = c.exports[expYears[1]];
          const pct = prev ? ((cur - prev) / prev) * 100 : 0;
          ticker.push({
            l: `${c.id} EXPORTS`,
            v: fmtBillion(cur),
            c: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
            up: pct >= 0,
            year: expYears[0],
          });
        }
        if (impYears.length >= 2) {
          const cur = c.imports[impYears[0]];
          const prev = c.imports[impYears[1]];
          const pct = prev ? ((cur - prev) / prev) * 100 : 0;
          ticker.push({
            l: `${c.id} IMPORTS`,
            v: fmtBillion(cur),
            c: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
            up: pct >= 0,
            year: impYears[0],
          });
        }
      });

      // Full country dataset
      const countries = Object.values(byCountry).map(c => {
        const expYears = Object.keys(c.exports || {}).sort().reverse();
        const impYears = Object.keys(c.imports || {}).sort().reverse();
        const latestExport = expYears[0] ? c.exports[expYears[0]] : null;
        const latestImport = impYears[0] ? c.imports[impYears[0]] : null;
        const prevExport = expYears[1] ? c.exports[expYears[1]] : null;
        const prevImport = impYears[1] ? c.imports[impYears[1]] : null;
        return {
          id: c.id,
          name: c.name,
          exports: latestExport,
          imports: latestImport,
          exports_yoy: prevExport ? ((latestExport - prevExport) / prevExport) * 100 : null,
          imports_yoy: prevImport ? ((latestImport - prevImport) / prevImport) * 100 : null,
          trade_balance: latestExport && latestImport ? latestExport - latestImport : null,
          year: expYears[0] || impYears[0],
          history: {
            exports: c.exports || {},
            imports: c.imports || {},
          },
        };
      });

      TRADE_CACHE.data = { ticker, countries, source: "World Bank", cached_at: new Date().toISOString() };
      TRADE_CACHE.ts = now;
    }

    let result = TRADE_CACHE.data;

    // Filter by country if requested
    if (country) {
      const code = country.toUpperCase();
      const filtered = result.countries.filter(c => c.id === code || c.name.toLowerCase().includes(country.toLowerCase()));
      result = { ...result, countries: filtered };
    }

    // Filter by flow
    if (flow === "exports") {
      result = { ...result, ticker: result.ticker.filter(t => t.l.includes("EXPORTS")) };
    } else if (flow === "imports") {
      result = { ...result, ticker: result.ticker.filter(t => t.l.includes("IMPORTS")) };
    }

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Trade data error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function fmtBillion(v) {
  if (!v) return "N/A";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

// ── AGENT ROUTE ──
app.post("/api/agent", async (req, res) => {
  try {
    const { agentId, message, history } = req.body;
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const agentPrompts = {
      cyberguard:
        "You are CyberGuard, a cybersecurity AI agent for TradeIntel. Monitor threats, block attacks, analyze vulnerabilities. Be concise and technical.",
      customerai:
        "You are CustomerAI, a helpful customer support agent for TradeIntel. Help users with account issues, data questions, billing, and platform features. Be friendly and professional.",
      datapulse:
        "You are DataPulse, a data analytics AI agent for TradeIntel. Analyze trade data, generate reports, identify anomalies, track KPIs. Always include specific numbers.",
      sitekeeper:
        "You are SiteKeeper, a website maintenance AI agent for TradeIntel. Monitor infrastructure, optimize performance, manage deployments. Be technical and proactive.",
      tradescout:
        "You are TradeScout, a trade intelligence AI agent for TradeIntel. Identify trade leads, analyze market opportunities, detect seasonal trends. Provide actionable intelligence.",
    };

    const systemPrompt = agentPrompts[agentId] || agentPrompts.datapulse;
    const model = ["datapulse", "tradescout"].includes(agentId)
      ? "claude-opus-4-20250514"
      : "claude-sonnet-4-20250514";

    const response = await client.messages.create({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: history || [{ role: "user", content: message }],
    });

    res.json({
      success: true,
      agentId,
      model,
      response: response.content[0].text,
    });
  } catch (error) {
    console.error("Agent error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ── HEALTH CHECK ──
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    agents: "all operational",
  });
});

// ── START SERVER ──
const PORT = 8080;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║   IXIntel OS Backend v2           ║
  ║   Server running on port ${PORT}  ║
  ║   All 5 AI Agents Ready           ║
  ║   Status: OPERATIONAL             ║
  ╚═══════════════════════════════════╝
  `);
});
startBot();
module.exports = app;
