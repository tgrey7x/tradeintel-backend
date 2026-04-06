// ════════════════════════════════════════════════════════════════
// simple-search.js — Phase 1B Task #5 (Simple Mode AI Search)
// Source of truth: CLAUDE.md
//
// MODULAR ARCHITECTURE RULE: this file is a self-contained Express
// router. It can be mounted, unmounted, or replaced without touching
// server.js beyond one require + one app.use(). Do not inline
// simple-search logic anywhere else.
//
// Exposes:
//   • router           — POST /api/simple-search
//   • parseQuery()     — unit-testable natural-language → structured params
// ════════════════════════════════════════════════════════════════

const express = require('express');
const { safeJsonParse } = require('./lib/clean-json');
const router = express.Router();

// ── CONFIG ──
// Keep models in one place so they can be swapped from here alone.
const MODELS = {
  fast:    'claude-sonnet-4-20250514',     // used by parser
  deep:    'claude-opus-4-20250514',       // reserved for deep-dive follow-ups
};

// System prompt for the query-parser step.
// Kept as a module constant so it can be edited without touching the route.
const PARSER_SYSTEM_PROMPT = `You are the query parser for IXIntel Simple Mode.
Your job: turn a plain-English trade question into a short, structured answer
and optionally a list of 1–4 concrete sources/callouts the UI can render as cards.

Return JSON ONLY with this shape:
{
  "answer": "<1-3 sentence direct answer to the user's question>",
  "sources": [
    { "label": "<short title>", "detail": "<1-2 sentence detail>", "meta": "<data source or HS code or year>" }
  ]
}

Do not include markdown fences. Do not include commentary outside the JSON.
If the question is not about trade, politely redirect in the "answer" field and return an empty sources array.`;

// ── CLAUDE CLIENT (lazy) ──
// Required lazily so this module can be loaded even if the SDK package
// isn't installed in some environments.
let _client = null;
function getClient() {
  if (_client) return _client;
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── PARSER ──
// Exported so it can be unit-tested or reused by other modules.
async function parseQuery(query) {
  const client = getClient();
  const response = await client.messages.create({
    model: MODELS.fast,
    max_tokens: 800,
    system: PARSER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: query }],
  });
  const text = response.content?.[0]?.text || '{}';
  const result = safeJsonParse(text);
  if (result.ok) {
    return {
      answer: String(result.value.answer || '').slice(0, 2000),
      sources: Array.isArray(result.value.sources) ? result.value.sources.slice(0, 6) : [],
      model: MODELS.fast,
    };
  }
  // Fallback: return raw text as the answer so the user still sees something.
  return { answer: String(text).slice(0, 2000), sources: [], model: MODELS.fast };
}

// ── ROUTE: health check (no token cost) ──
// GET /api/simple-search/health
// Verifies the module is loaded and the SDK + API key are configured.
// Does NOT call Claude — so it's free to hit from the browser or curl.
router.get('/api/simple-search/health', (req, res) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  let sdkOk = false;
  try { require.resolve('@anthropic-ai/sdk'); sdkOk = true; } catch (_) {}
  res.json({
    success: true,
    module: 'simple-search',
    status: hasKey && sdkOk ? 'ready' : 'not-ready',
    checks: {
      anthropic_api_key: hasKey ? 'set' : 'missing',
      anthropic_sdk:     sdkOk  ? 'installed' : 'missing',
    },
    model_fast: MODELS.fast,
    model_deep: MODELS.deep,
    brand: req.brand?.slug || 'ixintel',
  });
});

// ── ROUTE ──
// POST /api/simple-search  { query: string }
router.post('/api/simple-search', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) {
      return res.status(400).json({ success: false, error: 'query is required' });
    }
    if (query.length > 500) {
      return res.status(400).json({ success: false, error: 'query too long (max 500 chars)' });
    }

    const result = await parseQuery(query);
    res.json({
      success: true,
      brand: req.brand?.slug || 'ixintel',
      ...result,
    });
  } catch (err) {
    console.error('Simple search error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = { router, parseQuery, MODELS, PARSER_SYSTEM_PROMPT };
