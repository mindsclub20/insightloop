import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateResearchBudget, getApiKeyCandidates, normalizeGroundingSources, parseJsonObject } from '../supabase/functions/_shared/research-agent-utils.js';

test('routes each workload to its assigned key first and falls back only to configured keys', () => {
  const env = { GEMINI_API_KEY: 'k1', GEMINI_API_KEY_4: 'k4', GEMINI_API_KEY_6: 'k6' };
  assert.deepEqual(getApiKeyCandidates(env, 'evidence_analysis').map((x) => x.name), ['GEMINI_API_KEY_4', 'GEMINI_API_KEY_6', 'GEMINI_API_KEY']);
  assert.deepEqual(getApiKeyCandidates(env, 'web_research').map((x) => x.value), ['k1', 'k4', 'k6']);
});

test('rejects unsupported workloads and ignores missing/blank keys', () => {
  assert.throws(() => getApiKeyCandidates({}, 'unknown'), /Unsupported AI workload/);
  assert.deepEqual(getApiKeyCandidates({ GEMINI_API_KEY: '  ' }, 'web_research'), []);
});

test('budget includes participant rewards and the 100-token platform fee', () => {
  assert.deepEqual(calculateResearchBudget(100, 5), {
    sampleSize: 100, rewardPerResponse: 5, participantRewards: 500, platformFee: 100,
    totalTokensRequired: 600, providerChargesIncluded: false,
    note: 'AI/search provider charges are not included in token reservations; only participant rewards and the platform fee are counted here.',
  });
});

test('budget rejects invalid sample sizes, rewards, and fees', () => {
  assert.throws(() => calculateResearchBudget(9, 5), /between 10 and 500/);
  assert.throws(() => calculateResearchBudget(501, 5), /between 10 and 500/);
  assert.throws(() => calculateResearchBudget(100, 4), /at least 5 tokens/);
  assert.throws(() => calculateResearchBudget(100, 5.5), /whole number/);
  assert.throws(() => calculateResearchBudget(100, 5, -1), /non-negative/);
});

test('parses JSON responses with optional markdown fences and rejects arrays', () => {
  const fence = String.fromCharCode(96).repeat(3);
  assert.deepEqual(parseJsonObject(fence + 'json\n{"ok":true}\n' + fence), { ok: true });
  assert.throws(() => parseJsonObject('[1,2]'), /JSON object/);
  assert.throws(() => parseJsonObject('not json'), SyntaxError);
});

test('normalizes grounded sources, removes duplicates, and ignores non-web URIs', () => {
  assert.deepEqual(normalizeGroundingSources({ groundingChunks: [
    { web: { title: 'Example', uri: 'https://example.com/a' } },
    { web: { title: 'Duplicate', uri: 'https://example.com/a' } },
    { web: { title: 'Unsafe', uri: 'javascript:alert(1)' } },
    { web: { uri: 'https://example.org' } },
  ] }), [
    { title: 'Example', url: 'https://example.com/a' },
    { title: 'https://example.org', url: 'https://example.org' },
  ]);
});
