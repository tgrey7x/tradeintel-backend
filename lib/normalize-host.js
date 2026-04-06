// ════════════════════════════════════════════════════════════════
// lib/normalize-host.js — pure hostname normalizer
//
// Zero dependencies. Used by brands.js hostMiddleware + unit tests.
// Keep pure (no I/O, no side effects) so it stays trivially testable.
// ════════════════════════════════════════════════════════════════

/**
 * Normalize a Host header / req.hostname value for lookup in the
 * custom_domains table.
 *
 *   - null / undefined → ""
 *   - strip :port suffix
 *   - remove trailing dot (FQDN form)
 *   - lowercase
 *   - trim whitespace
 *
 * Does NOT strip protocol or path — callers should already pass just
 * the host portion (that's what Express's req.hostname gives).
 */
function normalizeHost(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .trim()
    .split(':')[0]
    .replace(/\.$/, '')
    .toLowerCase();
}

/**
 * Cheap hostname shape validation. Used by the domain-add endpoint.
 * Accepts FQDNs like "trade.acme.com" or "sub.sub.acme.co.uk".
 * Rejects empty, IP addresses, underscores, and anything without a TLD.
 */
function isValidHostname(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  if (!h) return false;
  if (h.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(h);
}

module.exports = { normalizeHost, isValidHostname };
