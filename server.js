require("dotenv").config();
const path = require("path");
const express = require("express");
const { startBot, sendAlert } = require("./telegram");
const authRoutes = require("./auth");
// ── PHASE 1B TASK #5 MODULES (each self-contained, plug-and-play) ──
const brands = require("./brands");
const simpleSearch = require("./simple-search");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();

// ── SECURITY MIDDLEWARE ──
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false, // inline scripts in HTML pages require this
}));
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

// ── BRAND MIDDLEWARE ──
// Attaches req.brand to every request based on Host header. Degrades to
// the default brand if the brands table hasn't been migrated yet.
app.use(brands.hostMiddleware);

// ── ROUTES ──
app.use("/auth", authRoutes);
// Task #5 modules — mounted at root so each owns its own URL prefix.
app.use(brands.router);
app.use(simpleSearch.router);
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

// Task #5 — Simple Mode UI (isolated page, does not touch index.html)
app.get("/simple", (req, res) => {
  res.sendFile("simple.html", { root: ROOT });
});

// ── TRADE DATA ROUTE ──
// World Bank API — no key required
// GET /api/trade-data?country=US&flow=both&year=2024
const TRADE_CACHE = { data: null, ts: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const WB_COUNTRIES = "US;CN;DE;JP;IN;MX;CA;KR;GB;BR;VNM;SGP";
const WB_BASE = "https://api.worldbank.org/v2";
const CENSUS_BASE = "https://api.census.gov/data/timeseries/intltrade";

// Census HS4 commodities to track [code, label]
const CENSUS_IMP_HS = [
  ["8471","COMPUTERS"],["8517","TELECOM"],["8703","VEHICLES"],
  ["2709","PETROLEUM"],["8542","SEMICON"],["8528","DISPLAYS"],
  ["6110","APPAREL"],["9401","FURNITURE"],
];
const CENSUS_EXP_HS = [
  ["8802","AIRCRAFT"],["8703","VEHICLES"],["8471","COMPUTERS"],
  ["8517","TELECOM"],["2710","REFINED OIL"],["8542","SEMICON"],
];

async function fetchWB(indicator, countries, mrv = 1) {
  const url = `${WB_BASE}/country/${countries}/indicator/${indicator}?format=json&mrv=${mrv}&per_page=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank API error: ${res.status}`);
  const json = await res.json();
  return json[1] || [];
}

async function fetchCensusHS(type, hs, month) {
  const ep = type === "imp" ? "imports" : "exports";
  const valField = type === "imp" ? "GEN_VAL_MO" : "ALL_VAL_MO";
  const commField = type === "imp" ? "I_COMMODITY" : "E_COMMODITY";
  const url = `${CENSUS_BASE}/${ep}/hs?get=${valField},CTY_NAME&${commField}=${hs}&COMM_LVL=HS4&time=${month}`;
  const res = await fetch(url);
  if (res.status !== 200) return null;
  const json = await res.json();
  return parseInt(json[1]?.[0]) || null;
}

// Find the latest month Census has data for (checks last 6 months)
async function findLatestCensusMonth() {
  const now = new Date();
  for (let i = 2; i <= 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const val = await fetchCensusHS("imp", "8471", m);
    if (val) return m;
  }
  return null;
}

// Build Census ticker items with YoY comparison
async function buildCensusTicker() {
  const curMonth = await findLatestCensusMonth();
  if (!curMonth) return { items: [], month: null };

  // Prior year same month for YoY
  const [y, mo] = curMonth.split("-");
  const prevMonth = `${parseInt(y) - 1}-${mo}`;

  // Fire all commodity fetches in parallel
  const [impResults, expResults] = await Promise.all([
    Promise.all(CENSUS_IMP_HS.map(([hs]) =>
      Promise.all([fetchCensusHS("imp", hs, curMonth), fetchCensusHS("imp", hs, prevMonth)])
    )),
    Promise.all(CENSUS_EXP_HS.map(([hs]) =>
      Promise.all([fetchCensusHS("exp", hs, curMonth), fetchCensusHS("exp", hs, prevMonth)])
    )),
  ]);

  const items = [];

  CENSUS_IMP_HS.forEach(([, label], i) => {
    const [cur, prev] = impResults[i];
    if (!cur) return;
    const pct = prev ? ((cur - prev) / prev) * 100 : null;
    items.push({
      l: `US IMP · ${label}`,
      v: fmtBillion(cur),
      c: pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% YoY` : "",
      up: pct === null ? true : pct >= 0,
      source: "census",
      period: curMonth,
    });
  });

  CENSUS_EXP_HS.forEach(([, label], i) => {
    const [cur, prev] = expResults[i];
    if (!cur) return;
    const pct = prev ? ((cur - prev) / prev) * 100 : null;
    items.push({
      l: `US EXP · ${label}`,
      v: fmtBillion(cur),
      c: pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% YoY` : "",
      up: pct === null ? true : pct >= 0,
      source: "census",
      period: curMonth,
    });
  });

  return { items, month: curMonth };
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

      // Census Bureau monthly data (most recent available month, ~2 month lag)
      const census = await buildCensusTicker();

      // Merge: WB annual items get source tag, Census items already tagged
      const wbTicker = ticker.map(t => ({ ...t, source: "worldbank" }));

      // Separator item between data sets
      const separator = census.month ? [{
        l: "━━━━━━━━━━",
        v: "",
        c: "",
        up: true,
        source: "separator",
        period: null,
      }] : [];

      TRADE_CACHE.data = {
        ticker: [...wbTicker, ...separator, ...census.items],
        wbTicker,
        censusTicker: census.items,
        countries,
        source: "World Bank + US Census Bureau",
        wb_year: "2024",
        census_month: census.month,
        cached_at: new Date().toISOString(),
      };
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

// Pre-warm trade data cache so first browser request is instant
fetch(`http://localhost:${PORT}/api/trade-data`)
  .then(() => console.log("  Trade data cache warmed."))
  .catch(() => {});

module.exports = app;
