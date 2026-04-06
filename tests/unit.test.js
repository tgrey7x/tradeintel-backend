// ════════════════════════════════════════════════════════════════
// tests/unit.test.js — pure-function unit tests
//
// Uses Node's built-in test runner (Node >= 18). Run with:
//   npm test         (via package.json script)
//   node --test tests/
//
// These tests target the dependency-free helpers in lib/ so they run
// in any environment — no npm install, no network, no mocks required.
// Modules that depend on Express / Supabase / Anthropic are NOT tested
// here; integration coverage for those comes from the health-check
// endpoints in simple-search.js and agents.js.
// ════════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeHost, isValidHostname } = require('../lib/normalize-host');
const { cleanJsonResponse, safeJsonParse }  = require('../lib/clean-json');
const { fmtBillion }                         = require('../lib/fmt-billion');

// ── normalizeHost ──────────────────────────────────────────────────

test('normalizeHost: null and undefined → empty string', () => {
  assert.equal(normalizeHost(null), '');
  assert.equal(normalizeHost(undefined), '');
});

test('normalizeHost: lowercases', () => {
  assert.equal(normalizeHost('EXAMPLE.com'), 'example.com');
});

test('normalizeHost: strips port', () => {
  assert.equal(normalizeHost('example.com:8080'), 'example.com');
  assert.equal(normalizeHost('localhost:3000'), 'localhost');
});

test('normalizeHost: strips trailing dot (FQDN form)', () => {
  assert.equal(normalizeHost('example.com.'), 'example.com');
});

test('normalizeHost: trims whitespace', () => {
  assert.equal(normalizeHost('  example.com  '), 'example.com');
});

test('normalizeHost: combines all cases', () => {
  assert.equal(normalizeHost('  TRADE.Acme.COM.:443  '), 'trade.acme.com');
});

// ── isValidHostname ────────────────────────────────────────────────

test('isValidHostname: accepts normal FQDNs', () => {
  assert.equal(isValidHostname('example.com'), true);
  assert.equal(isValidHostname('trade.acme.com'), true);
  assert.equal(isValidHostname('sub.sub.example.co.uk'), true);
});

test('isValidHostname: rejects empty and garbage', () => {
  assert.equal(isValidHostname(''), false);
  assert.equal(isValidHostname(null), false);
  assert.equal(isValidHostname(undefined), false);
  assert.equal(isValidHostname(42), false);
  assert.equal(isValidHostname('localhost'), false); // no TLD
  assert.equal(isValidHostname('no-tld'), false);
});

test('isValidHostname: rejects trailing dash segment', () => {
  assert.equal(isValidHostname('-example.com'), false);
  assert.equal(isValidHostname('example-.com'), false);
});

test('isValidHostname: rejects hostnames over 253 chars', () => {
  const long = 'a'.repeat(250) + '.com';
  assert.equal(isValidHostname(long), false);
});

// ── cleanJsonResponse ──────────────────────────────────────────────

test('cleanJsonResponse: passes plain JSON through', () => {
  assert.equal(cleanJsonResponse('{"a":1}'), '{"a":1}');
});

test('cleanJsonResponse: strips ```json fences', () => {
  assert.equal(cleanJsonResponse('```json\n{"a":1}\n```'), '{"a":1}');
});

test('cleanJsonResponse: strips bare ``` fences', () => {
  assert.equal(cleanJsonResponse('```\n{"a":1}\n```'), '{"a":1}');
});

test('cleanJsonResponse: handles null/undefined', () => {
  assert.equal(cleanJsonResponse(null), '');
  assert.equal(cleanJsonResponse(undefined), '');
});

test('cleanJsonResponse: trims surrounding whitespace', () => {
  assert.equal(cleanJsonResponse('  {"x":1}  '), '{"x":1}');
});

// ── safeJsonParse ──────────────────────────────────────────────────

test('safeJsonParse: success case', () => {
  const r = safeJsonParse('{"answer":"hi","sources":[]}');
  assert.equal(r.ok, true);
  assert.equal(r.value.answer, 'hi');
  assert.deepEqual(r.value.sources, []);
});

test('safeJsonParse: fenced success case', () => {
  const r = safeJsonParse('```json\n{"answer":"hi"}\n```');
  assert.equal(r.ok, true);
  assert.equal(r.value.answer, 'hi');
});

test('safeJsonParse: invalid JSON returns ok:false with raw', () => {
  const r = safeJsonParse('not json at all');
  assert.equal(r.ok, false);
  assert.equal(r.raw, 'not json at all');
});

test('safeJsonParse: never throws on any input', () => {
  assert.doesNotThrow(() => safeJsonParse(null));
  assert.doesNotThrow(() => safeJsonParse(undefined));
  assert.doesNotThrow(() => safeJsonParse(''));
  assert.doesNotThrow(() => safeJsonParse('{'));
  assert.doesNotThrow(() => safeJsonParse('```'));
});

// ── fmtBillion ─────────────────────────────────────────────────────

test('fmtBillion: N/A for zero and falsy', () => {
  assert.equal(fmtBillion(0), 'N/A');
  assert.equal(fmtBillion(null), 'N/A');
  assert.equal(fmtBillion(undefined), 'N/A');
});

test('fmtBillion: trillions', () => {
  assert.equal(fmtBillion(2.5e12), '$2.50T');
  assert.equal(fmtBillion(1e12), '$1.00T');
});

test('fmtBillion: billions', () => {
  assert.equal(fmtBillion(1e9), '$1.0B');
  assert.equal(fmtBillion(3.7e9), '$3.7B');
});

test('fmtBillion: millions (fallback)', () => {
  assert.equal(fmtBillion(250e6), '$250M');
  assert.equal(fmtBillion(1e6), '$1M');
});

test('fmtBillion: handles the US annual exports ballpark', () => {
  // US exports ~2.1T in 2024
  assert.equal(fmtBillion(2.1e12), '$2.10T');
});
