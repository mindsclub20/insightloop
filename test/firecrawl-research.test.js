import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFirecrawlResults } from '../supabase/functions/_shared/research-agent-utils.js';

test('normalizes Firecrawl web results into unique safe sources and bounded evidence', () => {
  const result = normalizeFirecrawlResults({
    data: {
      web: [
        { title: 'Market report', url: 'https://example.com/report', description: 'A report', markdown: '# Market\nEvidence details' },
        { title: 'Duplicate', url: 'https://example.com/report', description: 'Duplicate' },
        { title: 'Unsafe', url: 'javascript:alert(1)', description: 'Ignore' },
        { title: 'No URL', description: 'Ignore' },
      ],
    },
  });
  assert.deepEqual(result.sources, [
    { title: 'Market report', url: 'https://example.com/report' },
  ]);
  assert.match(result.evidenceText, /Evidence details/);
  assert.doesNotMatch(result.evidenceText, /javascript:/);
});

test('returns an empty result for malformed Firecrawl payloads', () => {
  assert.deepEqual(normalizeFirecrawlResults(null), { sources: [], evidenceText: '[]' });
  assert.deepEqual(normalizeFirecrawlResults({ data: { web: [] } }), { sources: [], evidenceText: '[]' });
});
