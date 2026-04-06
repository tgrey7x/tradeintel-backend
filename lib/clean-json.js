// ════════════════════════════════════════════════════════════════
// lib/clean-json.js — strip markdown fences from LLM JSON responses
//
// Zero dependencies. Used by simple-search.js parseQuery() + tests.
// ════════════════════════════════════════════════════════════════

/**
 * Claude (and most LLMs) sometimes wrap JSON responses in markdown
 * code fences even when told not to. This helper strips them.
 *
 *   ```json\n{...}\n```   →  {...}
 *   ```\n{...}\n```       →  {...}
 *   {...}                 →  {...}   (pass-through)
 *
 * Does NOT parse the JSON — just returns a clean string that
 * JSON.parse() has the best chance of accepting.
 */
function cleanJsonResponse(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/**
 * Safely parse LLM JSON output. Returns { ok: true, value } on
 * success or { ok: false, raw } on failure. Never throws.
 */
function safeJsonParse(text) {
  const cleaned = cleanJsonResponse(text);
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (_err) {
    return { ok: false, raw: cleaned };
  }
}

module.exports = { cleanJsonResponse, safeJsonParse };
