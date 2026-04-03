require("dotenv").config();
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
app.use(express.static(__dirname, { index: false }));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/login.html");
});

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
