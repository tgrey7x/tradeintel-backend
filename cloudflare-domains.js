// ════════════════════════════════════════════════════════════════
// cloudflare-domains.js — Phase 1B Task #5 (Custom Hostname SSL)
// Source of truth: CLAUDE.md
//
// MODULAR ARCHITECTURE RULE: self-contained Express router. Extends
// brands.js by provisioning Cloudflare SaaS custom hostnames (which
// handles SSL issuance + renewal automatically) once a domain has
// been DNS-verified by brands.js.
//
// GRACEFUL DEGRADATION:
//   If CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID is not set, this
//   module still loads but every mutating endpoint returns:
//     { success: false, error: 'Cloudflare not configured' }
//   No exceptions, no 500s, no boot failure. The moment the env vars
//   are added in Railway and the server restarts, the module goes live.
//
// ENV VARS (set in Railway Variables):
//   CLOUDFLARE_API_TOKEN  — API token with Custom Hostnames Edit perm
//   CLOUDFLARE_ZONE_ID    — zone ID for ixintel.ai (or the white-label
//                           parent zone that owns the custom hostnames)
//
// Exposes:
//   • router                      — admin provisioning routes
//   • isConfigured()              — sync helper
//   • provisionHostname(hostname) — async, returns Cloudflare response
//   • getHostnameStatus(id)       — async, polls SSL status
// ════════════════════════════════════════════════════════════════

const express = require('express');
const { supabaseAdmin } = require('./db');
const { normalizeHost, isValidHostname } = require('./lib/normalize-host');

const router = express.Router();

// ── CONFIG ──
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function isConfigured() {
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID);
}

function notConfiguredError() {
  return {
    success: false,
    error: 'Cloudflare not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in Railway Variables.',
  };
}

// ── AUTH HELPER (same pattern as brands.js) ──
async function requireAdmin(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) {
    res.status(401).json({ success: false, error: 'Invalid token' });
    return null;
  }
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!['admin', 'super_admin'].includes(profile?.role)) {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return null;
  }
  return user;
}

// ── CLOUDFLARE API CLIENT ──
// Thin fetch wrapper. All Cloudflare API responses share the shape:
//   { success: bool, errors: [...], messages: [...], result: {...} }
async function cfFetch(path, options = {}) {
  const url = `${CF_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    const errMsg = json.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API: ${errMsg}`);
  }
  return json.result;
}

// ── CORE OPERATIONS ──
// https://developers.cloudflare.com/api/operations/custom-hostname-for-a-zone-create-custom-hostname

/**
 * Provision a new custom hostname in Cloudflare. Cloudflare handles:
 *   - SSL certificate issuance (DigiCert or Let's Encrypt)
 *   - Ongoing renewal
 *   - HTTP-01 or TXT validation
 *
 * The customer's DNS must already CNAME the hostname to our Cloudflare
 * zone (instructed via brands.js when they add the domain).
 */
async function provisionHostname(hostname) {
  if (!isConfigured()) throw new Error('Cloudflare not configured');
  const clean = normalizeHost(hostname);
  if (!isValidHostname(clean)) throw new Error('Invalid hostname');

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  return await cfFetch(`/zones/${zoneId}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify({
      hostname: clean,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: {
          http2: 'on',
          min_tls_version: '1.2',
          tls_1_3: 'on',
        },
      },
    }),
  });
}

/**
 * Poll the status of an existing custom hostname.
 * Returns fields including `status`, `ssl.status`, `verification_errors`.
 */
async function getHostnameStatus(cfHostnameId) {
  if (!isConfigured()) throw new Error('Cloudflare not configured');
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  return await cfFetch(`/zones/${zoneId}/custom_hostnames/${cfHostnameId}`);
}

/**
 * Delete a custom hostname (when a brand removes a domain).
 */
async function deleteHostname(cfHostnameId) {
  if (!isConfigured()) throw new Error('Cloudflare not configured');
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  return await cfFetch(`/zones/${zoneId}/custom_hostnames/${cfHostnameId}`, {
    method: 'DELETE',
  });
}

// ════════════════════════════════════════════════════════════════
// HTTP ROUTES
// ════════════════════════════════════════════════════════════════

// GET /api/cloudflare/health — diagnostic, no API call
router.get('/api/cloudflare/health', (_req, res) => {
  res.json({
    success: true,
    module: 'cloudflare-domains',
    status: isConfigured() ? 'ready' : 'not-configured',
    checks: {
      api_token: process.env.CLOUDFLARE_API_TOKEN ? 'set' : 'missing',
      zone_id:   process.env.CLOUDFLARE_ZONE_ID   ? 'set' : 'missing',
    },
  });
});

// POST /auth/admin/brands/:brandId/domains/:id/provision-ssl
// Called after brands.js has DNS-verified a domain. Creates the
// Cloudflare custom hostname and stores the Cloudflare ID back in
// custom_domains.ssl_status for later status polls.
router.post('/auth/admin/brands/:brandId/domains/:id/provision-ssl', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!isConfigured()) return res.status(503).json(notConfiguredError());

  try {
    // Load the domain row, confirm it belongs to the brand and is verified.
    const { data: domain, error: fetchErr } = await supabaseAdmin
      .from('custom_domains')
      .select('*')
      .eq('id', req.params.id)
      .eq('brand_id', req.params.brandId)
      .single();
    if (fetchErr || !domain) {
      return res.status(404).json({ success: false, error: 'Domain not found' });
    }
    if (!domain.verified) {
      return res.status(400).json({
        success: false,
        error: 'Domain must be DNS-verified before SSL provisioning. Call /verify first.',
      });
    }

    const cfResult = await provisionHostname(domain.hostname);

    // Mirror Cloudflare's status into custom_domains.ssl_status.
    // Possible CF values: pending, active, moved, deleted, deactivated,
    //                     blocked, pending_deletion, pending_blocked, etc.
    const cfStatus = cfResult?.ssl?.status || cfResult?.status || 'pending';

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('custom_domains')
      .update({
        ssl_status: cfStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (updErr) throw updErr;

    res.json({
      success: true,
      domain: updated,
      cloudflare: {
        id: cfResult?.id,
        status: cfResult?.status,
        ssl_status: cfResult?.ssl?.status,
        ssl_method: cfResult?.ssl?.method,
        verification_errors: cfResult?.ssl?.validation_errors || [],
      },
    });
  } catch (err) {
    console.error('Cloudflare provision error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /auth/admin/brands/:brandId/domains/:id/ssl-status
// Poll Cloudflare for the latest status. Does NOT rely on a stored
// Cloudflare ID — looks up the hostname by name so this works even if
// the initial provision call was interrupted.
router.get('/auth/admin/brands/:brandId/domains/:id/ssl-status', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!isConfigured()) return res.status(503).json(notConfiguredError());

  try {
    const { data: domain } = await supabaseAdmin
      .from('custom_domains')
      .select('hostname, ssl_status')
      .eq('id', req.params.id)
      .eq('brand_id', req.params.brandId)
      .single();
    if (!domain) return res.status(404).json({ success: false, error: 'Domain not found' });

    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const list = await cfFetch(`/zones/${zoneId}/custom_hostnames?hostname=${encodeURIComponent(domain.hostname)}`);
    const match = Array.isArray(list) ? list[0] : list;
    if (!match) {
      return res.json({
        success: true,
        ssl_status: 'not-provisioned',
        note: 'Domain exists in our DB but not in Cloudflare. Call /provision-ssl.',
      });
    }

    res.json({
      success: true,
      ssl_status: match?.ssl?.status || 'unknown',
      cf_status: match?.status,
      cf_id: match?.id,
      verification_errors: match?.ssl?.validation_errors || [],
    });
  } catch (err) {
    console.error('Cloudflare status error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /auth/admin/brands/:brandId/domains/:id/cloudflare
// Remove the custom hostname from Cloudflare (doesn't touch the DB row).
router.delete('/auth/admin/brands/:brandId/domains/:id/cloudflare', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!isConfigured()) return res.status(503).json(notConfiguredError());

  try {
    const { data: domain } = await supabaseAdmin
      .from('custom_domains')
      .select('hostname')
      .eq('id', req.params.id)
      .eq('brand_id', req.params.brandId)
      .single();
    if (!domain) return res.status(404).json({ success: false, error: 'Domain not found' });

    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const list = await cfFetch(`/zones/${zoneId}/custom_hostnames?hostname=${encodeURIComponent(domain.hostname)}`);
    const match = Array.isArray(list) ? list[0] : list;
    if (match?.id) await deleteHostname(match.id);

    res.json({ success: true, deleted: !!match?.id });
  } catch (err) {
    console.error('Cloudflare delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = {
  router,
  isConfigured,
  provisionHostname,
  getHostnameStatus,
  deleteHostname,
  _internals: { cfFetch },
};
