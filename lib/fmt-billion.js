// ════════════════════════════════════════════════════════════════
// lib/fmt-billion.js — currency formatter for trade data values
//
// Zero dependencies. Used by trade-data.js + simple-search.js + tests.
// Rules:
//   - null / 0 / undefined  → "N/A"
//   - >= 1 trillion         → "$X.XXT"
//   - >= 1 billion          → "$X.XB"
//   - else                  → "$Xm"  (millions, no decimal)
// ════════════════════════════════════════════════════════════════

function fmtBillion(v) {
  if (!v) return 'N/A';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

module.exports = { fmtBillion };
