// ════════════════════════════════════════════════════════════════
// agents.js — 5-agent Claude API router
// Source of truth: CLAUDE.md (AI Agent Suite)
//
// MODULAR ARCHITECTURE RULE: self-contained Express router.
// System prompts live in AGENT_PROMPTS so new agents can be added
// by editing this file alone — no cross-file edits required.
//
// Exposes:
//   • router          — POST /api/agent
//   • AGENT_PROMPTS   — keyed system prompts (editable)
// ════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

// ── AGENT REGISTRY ──
// To add a new agent: append here + optionally tune model selection below.
// No server.js edits required.
const AGENT_PROMPTS = {
  cyberguard:
    'You are CyberGuard, a cybersecurity AI agent for TradeIntel. Monitor threats, block attacks, analyze vulnerabilities. Be concise and technical.',
  customerai:
    'You are CustomerAI, a helpful customer support agent for TradeIntel. Help users with account issues, data questions, billing, and platform features. Be friendly and professional.',
  datapulse:
    'You are DataPulse, a data analytics AI agent for TradeIntel. Analyze trade data, generate reports, identify anomalies, track KPIs. Always include specific numbers.',
  sitekeeper:
    'You are SiteKeeper, a website maintenance AI agent for TradeIntel. Monitor infrastructure, optimize performance, manage deployments. Be technical and proactive.',
  tradescout:
    'You are TradeScout, a trade intelligence AI agent for TradeIntel. Identify trade leads, analyze market opportunities, detect seasonal trends. Provide actionable intelligence.',
};

// ── MODEL SELECTION ──
// Higher-reasoning agents get Opus; tactical agents get Sonnet.
const MODELS = {
  fast: 'claude-sonnet-4-20250514',
  deep: 'claude-opus-4-20250514',
};
const DEEP_AGENTS = new Set(['datapulse', 'tradescout']);
function pickModel(agentId) {
  return DEEP_AGENTS.has(agentId) ? MODELS.deep : MODELS.fast;
}

// ── LAZY CLIENT ──
let _client = null;
function getClient() {
  if (_client) return _client;
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── ROUTE ──
router.post('/api/agent', async (req, res) => {
  try {
    const { agentId, message, history } = req.body;
    const systemPrompt = AGENT_PROMPTS[agentId] || AGENT_PROMPTS.datapulse;
    const model = pickModel(agentId);

    const client = getClient();
    const response = await client.messages.create({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: history || [{ role: 'user', content: message }],
    });

    res.json({
      success: true,
      agentId,
      model,
      response: response.content[0].text,
    });
  } catch (error) {
    console.error('Agent error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── DIAGNOSTIC ──
// GET /api/agent/health — no token cost
router.get('/api/agent/health', (req, res) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  let sdkOk = false;
  try { require.resolve('@anthropic-ai/sdk'); sdkOk = true; } catch (_) {}
  res.json({
    success: true,
    module: 'agents',
    status: hasKey && sdkOk ? 'ready' : 'not-ready',
    agents: Object.keys(AGENT_PROMPTS),
    checks: {
      anthropic_api_key: hasKey ? 'set' : 'missing',
      anthropic_sdk:     sdkOk  ? 'installed' : 'missing',
    },
  });
});

module.exports = { router, AGENT_PROMPTS, pickModel, MODELS };
