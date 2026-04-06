// ════════════════════════════════════════════════════════════════
// brands.js — Phase 1B Task #5 (Brand Swap + Custom Domain)
// Source of truth: CLAUDE.md
//
// Exposes:
//   • hostMiddleware       — attaches req.brand based on Host header
//   • router               — /api/brand + /auth/admin/brands + /auth/admin/domains
//   • getDefaultBrand()    — cached lookup of the "is_default" brand row
//
// The brands + custom_domains tables come from migrations/001_brands.sql.
// Everything here degrades gracefully if those tables don't exist yet:
// the default brand below is used as a fallback so the existing UI never
// breaks during rollout.
// ════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('./db');

const router = express.Router();

// ── FALLBACK DEFAULT BRAND ──
// Used when Supabase is unreachable or the brands table hasn't been migrated.
// Must match the seed row in migrations/001_brands.sql.
const FALLBACK_BRAND = Object.freeze({
  id: null,
  slug: 'ixintel',
  name: 'IXIntel',
  tagline: 'Global Trade Intelligence',
  logo_url: '',
  favicon_url: '',
  primary_color: '#00ff9f',
  accent_color: '#00b8ff',
  support_email: '',
  is_default: true,
});

// ── IN-MEMORY CACHE ──
// Brand lookups happen on every request; cache by hostname for 5 minutes.
const CACHE_TTL = 5 * 60 * 1000;
const brandCache = new Map();       // key: hostname → { brand, ts }
let defaultBrandCache = null;
let defaultBrandCacheTs = 0;

function cacheGet(host) {
  const entry = brandCache.get(host);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    brandCache.delete(host);
    return null;
  }
  return entry.brand;
}

function cacheSet(host, brand) {
  brandCache.set(host, { brand, ts: Date.now() });
}

function invalidateCache() {
  brandCache.clear();
  defaultBrandCache = null;
  defaultBrandCacheTs = 0;
}

// ── DEFAULT BRAND LOOKUP ──
async function getDefaultBrand() {
  if (defaultBrandCache && Date.now() - defaultBrandCacheTs < CACHE_TTL) {
    return defaultBrandCache;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .select('*')
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    defaultBrandCache = data || FALLBACK_BRAND;
  } catch (_err) {
    defaultBrandCache = FALLBACK_BRAND;
  }
  defaultBrandCacheTs = Date.now();
  return defaultBrandCache;
}

// ── RESOLVE BRAND FOR A HOSTNAME ──
// 1. Strip port, lowercase, remove trailing dot
// 2. Look for a verified custom_domains row → follow to brand
// 3. Otherwise return the default brand
async function resolveBrandForHost(rawHost) {
  if (!rawHost) return getDefaultBrand();
  const host = String(rawHost).split(':')[0].replace(/\.$/, '').toLowerCase();

  const cached = cacheGet(host);
  if (cached) return cached;

  try {
    const { data: domainRow } = await supabaseAdmin
      .from('custom_domains')
      .select('brand_id, verified')
      .eq('hostname', host)
      .eq('verified', true)
      .maybeSingle();

    if (domainRow && domainRow.brand_id) {
      const { data: brand } = await supabaseAdmin
        .from('brands')
        .select('*')
        .eq('id', domainRow.brand_id)
        .maybeSingle();
      if (brand) {
        cacheSet(host, brand);
        return brand;
      }
    }
  } catch (_err) {
    // Table may not exist yet — fall through to default.
  }

  const def = await getDefaultBrand();
  cacheSet(host, def);
  return def;
}

// ── EXPRESS MIDDLEWARE ──
// Attaches req.brand on every request. Never throws.
async function hostMiddleware(req, _res, next) {
  try {
    req.brand = await resolveBrandForHost(req.hostname || req.headers.host);
  } catch (_err) {
    req.brand = FALLBACK_BRAND;
  }
  next();
}

// ── AUTH HELPER ──
// Thin wrapper — mirrors the pattern already used in auth.js.
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

// ════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ════════════════════════════════════════════════════════════════

// GET /api/brand — return the brand for the current host
// Used by every HTML page to theme itself at page load.
router.get('/api/brand', async (req, res) => {
  const brand = req.brand || (await getDefaultBrand());
  res.json({ success: true, brand });
});

// ════════════════════════════════════════════════════════════════
// ADMIN ROUTES (mounted under /auth/admin/* by server.js)
// ════════════════════════════════════════════════════════════════

// GET /auth/admin/brands — list all brands
router.get('/auth/admin/brands', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, brands: data });
  } catch (err) {
    console.error('List brands error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /auth/admin/brands — create a brand
router.post('/auth/admin/brands', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const { slug, name, tagline, logo_url, primary_color, accent_color, support_email, owner_user_id } = req.body;
    if (!slug || !name) {
      return res.status(400).json({ success: false, error: 'slug and name are required' });
    }
    const { data, error } = await supabaseAdmin
      .from('brands')
      .insert({ slug, name, tagline, logo_url, primary_color, accent_color, support_email, owner_user_id })
      .select()
      .single();
    if (error) throw error;
    invalidateCache();
    res.json({ success: true, brand: data });
  } catch (err) {
    console.error('Create brand error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /auth/admin/brands/:id — update a brand
router.put('/auth/admin/brands/:id', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const allowed = ['name', 'tagline', 'logo_url', 'favicon_url', 'primary_color', 'accent_color', 'support_email', 'owner_user_id'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('brands')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    invalidateCache();
    res.json({ success: true, brand: data });
  } catch (err) {
    console.error('Update brand error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CUSTOM DOMAIN ROUTES ──

// GET /auth/admin/brands/:brandId/domains — list domains for a brand
router.get('/auth/admin/brands/:brandId/domains', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('custom_domains')
      .select('*')
      .eq('brand_id', req.params.brandId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, domains: data });
  } catch (err) {
    console.error('List domains error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /auth/admin/brands/:brandId/domains — add a domain (generates verification token)
router.post('/auth/admin/brands/:brandId/domains', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const hostname = String(req.body.hostname || '').toLowerCase().replace(/\.$/, '').trim();
    if (!hostname || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
      return res.status(400).json({ success: false, error: 'Invalid hostname' });
    }
    const verification_token = 'ixintel-verify-' + crypto.randomBytes(16).toString('hex');
    const { data, error } = await supabaseAdmin
      .from('custom_domains')
      .insert({
        brand_id: req.params.brandId,
        hostname,
        verification_token,
        verified: false,
        ssl_status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    res.json({
      success: true,
      domain: data,
      instructions: {
        step1: `Add a TXT record at _ixintel-verify.${hostname}`,
        step2: `Value: ${verification_token}`,
        step3: `Add a CNAME record at ${hostname} pointing to ixintel.ai (or whatever the platform origin is)`,
        step4: `Then call POST /auth/admin/brands/${req.params.brandId}/domains/${data.id}/verify`,
      },
    });
  } catch (err) {
    console.error('Create domain error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /auth/admin/brands/:brandId/domains/:id/verify
// Performs a DNS lookup for the TXT record and marks the domain verified if it matches.
router.post('/auth/admin/brands/:brandId/domains/:id/verify', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const { data: domain, error: fetchErr } = await supabaseAdmin
      .from('custom_domains')
      .select('*')
      .eq('id', req.params.id)
      .eq('brand_id', req.params.brandId)
      .single();
    if (fetchErr || !domain) {
      return res.status(404).json({ success: false, error: 'Domain not found' });
    }

    const dns = require('dns').promises;
    let records = [];
    try {
      records = await dns.resolveTxt(`_ixintel-verify.${domain.hostname}`);
    } catch (dnsErr) {
      return res.status(400).json({
        success: false,
        error: `DNS lookup failed: ${dnsErr.code || dnsErr.message}. Make sure the TXT record is published.`,
      });
    }

    const flat = records.map(r => r.join('')).join(',');
    if (!flat.includes(domain.verification_token)) {
      return res.status(400).json({
        success: false,
        error: 'Verification token not found in TXT record yet. DNS may still be propagating.',
      });
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('custom_domains')
      .update({
        verified: true,
        verified_at: new Date().toISOString(),
        ssl_status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (updErr) throw updErr;
    invalidateCache();
    res.json({ success: true, domain: updated });
  } catch (err) {
    console.error('Verify domain error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = {
  router,
  hostMiddleware,
  getDefaultBrand,
  resolveBrandForHost,
  invalidateCache,
  FALLBACK_BRAND,
};
