// ════════════════════════════════════════════════════════════════
// trade-data.js — World Bank + US Census trade data module
// Source of truth: CLAUDE.md (Priority Build Order #4 — IN PROGRESS)
//
// MODULAR ARCHITECTURE RULE: self-contained Express router. Extract
// from or re-mount into server.js with a single require + app.use.
// All cache state is private to this module.
//
// Exposes:
//   • router              — GET /api/trade-data
//   • buildTradeData()    — core refresh function (unit-testable)
//   • fmtBillion()        — formatter reused by simple-search
// ════════════════════════════════════════════════════════════════

const express = require('express');
const { fmtBillion } = require('./lib/fmt-billion');
const router = express.Router();

// ── PRIVATE CACHE ──
const TRADE_CACHE = { data: null, ts: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// ── CONFIG ──
const WB_COUNTRIES = 'US;CN;DE;JP;IN;MX;CA;KR;GB;BR;VNM;SGP';
const WB_BASE = 'https://api.worldbank.org/v2';
const CENSUS_BASE = 'https://api.census.gov/data/timeseries/intltrade';

// Census HS4 commodities to track [code, label]
const CENSUS_IMP_HS = [
  ['8471','COMPUTERS'],['8517','TELECOM'],['8703','VEHICLES'],
  ['2709','PETROLEUM'],['8542','SEMICON'],['8528','DISPLAYS'],
  ['6110','APPAREL'],['9401','FURNITURE'],
];
const CENSUS_EXP_HS = [
  ['8802','AIRCRAFT'],['8703','VEHICLES'],['8471','COMPUTERS'],
  ['8517','TELECOM'],['2710','REFINED OIL'],['8542','SEMICON'],
];

// ── WORLD BANK FETCH ──
async function fetchWB(indicator, countries, mrv = 1) {
  const url = `${WB_BASE}/country/${countries}/indicator/${indicator}?format=json&mrv=${mrv}&per_page=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank API error: ${res.status}`);
  const json = await res.json();
  return json[1] || [];
}

// ── CENSUS FETCH ──
async function fetchCensusHS(type, hs, month) {
  const ep = type === 'imp' ? 'imports' : 'exports';
  const valField = type === 'imp' ? 'GEN_VAL_MO' : 'ALL_VAL_MO';
  const commField = type === 'imp' ? 'I_COMMODITY' : 'E_COMMODITY';
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
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const val = await fetchCensusHS('imp', '8471', m);
    if (val) return m;
  }
  return null;
}

// Build Census ticker items with YoY comparison
async function buildCensusTicker() {
  const curMonth = await findLatestCensusMonth();
  if (!curMonth) return { items: [], month: null };

  const [y, mo] = curMonth.split('-');
  const prevMonth = `${parseInt(y) - 1}-${mo}`;

  const [impResults, expResults] = await Promise.all([
    Promise.all(CENSUS_IMP_HS.map(([hs]) =>
      Promise.all([fetchCensusHS('imp', hs, curMonth), fetchCensusHS('imp', hs, prevMonth)])
    )),
    Promise.all(CENSUS_EXP_HS.map(([hs]) =>
      Promise.all([fetchCensusHS('exp', hs, curMonth), fetchCensusHS('exp', hs, prevMonth)])
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
      c: pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% YoY` : '',
      up: pct === null ? true : pct >= 0,
      source: 'census',
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
      c: pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% YoY` : '',
      up: pct === null ? true : pct >= 0,
      source: 'census',
      period: curMonth,
    });
  });

  return { items, month: curMonth };
}

// ── CORE BUILDER ──
// Extracted so it can be unit-tested and pre-warmed.
async function buildTradeData() {
  const exportsHistRaw = await fetchWB('TX.VAL.MRCH.CD.WT', WB_COUNTRIES, 3);
  const importsHistRaw = await fetchWB('TM.VAL.MRCH.CD.WT', WB_COUNTRIES, 3);

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
  addRow(exportsHistRaw, 'exports');
  addRow(importsHistRaw, 'imports');

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
        c: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
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
        c: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
        up: pct >= 0,
        year: impYears[0],
      });
    }
  });

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

  const census = await buildCensusTicker();
  const wbTicker = ticker.map(t => ({ ...t, source: 'worldbank' }));

  const separator = census.month ? [{
    l: '━━━━━━━━━━',
    v: '',
    c: '',
    up: true,
    source: 'separator',
    period: null,
  }] : [];

  return {
    ticker: [...wbTicker, ...separator, ...census.items],
    wbTicker,
    censusTicker: census.items,
    countries,
    source: 'World Bank + US Census Bureau',
    wb_year: '2024',
    census_month: census.month,
    cached_at: new Date().toISOString(),
  };
}

// ── PRE-WARM HELPER (called once at server boot) ──
async function prewarm() {
  try {
    TRADE_CACHE.data = await buildTradeData();
    TRADE_CACHE.ts = Date.now();
    return true;
  } catch (err) {
    console.error('Trade data pre-warm failed:', err.message);
    return false;
  }
}

// ── ROUTE ──
router.get('/api/trade-data', async (req, res) => {
  try {
    const { country, flow } = req.query;
    const now = Date.now();

    if (!TRADE_CACHE.data || now - TRADE_CACHE.ts > CACHE_TTL) {
      TRADE_CACHE.data = await buildTradeData();
      TRADE_CACHE.ts = now;
    }

    let result = TRADE_CACHE.data;

    if (country) {
      const code = country.toUpperCase();
      const filtered = result.countries.filter(c =>
        c.id === code || c.name.toLowerCase().includes(country.toLowerCase())
      );
      result = { ...result, countries: filtered };
    }

    if (flow === 'exports') {
      result = { ...result, ticker: result.ticker.filter(t => t.l.includes('EXPORTS')) };
    } else if (flow === 'imports') {
      result = { ...result, ticker: result.ticker.filter(t => t.l.includes('IMPORTS')) };
    }

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Trade data error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = {
  router,
  buildTradeData,
  prewarm,
  fmtBillion,
  // internals exported for tests
  _internals: { fetchWB, fetchCensusHS, findLatestCensusMonth, buildCensusTicker },
};
