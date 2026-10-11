import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSITIONS } from '../src/lib/lifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// These two files implement the identical lifecycle graph in two languages
// (see supabase/functions/_shared/lifecycle.ts's header comment for why
// this duplication exists and the plan to eventually collapse it to one
// source of truth). Until that refactor happens, THIS test is what stands
// between "someone edits one copy and not the other" and that going
// unnoticed until a live Supabase deployment behaves differently than the
// local demo. It cannot run the Deno file, but a plain-text extraction of
// its TRANSITIONS object is enough to catch the drift that actually matters.
test('CONSISTENCY: Deno lifecycle.ts TRANSITIONS graph matches Node lifecycle.js exactly', () => {
  const denoSource = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/lifecycle.ts'), 'utf-8');

  // Pull out each `KEY: ['A', 'B'],` line from the Deno file's TRANSITIONS object.
  const denoTransitions = {};
  const lineRe = /^\s*(\w+):\s*\[([^\]]*)\],?\s*$/gm;
  let match;
  while ((match = lineRe.exec(denoSource)) !== null) {
    const key = match[1];
    const values = match[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    denoTransitions[key] = values;
  }

  assert.ok(Object.keys(denoTransitions).length > 0, 'failed to extract any transitions from lifecycle.ts - regex may need updating if the file format changed');

  const nodeKeys = Object.keys(TRANSITIONS).sort();
  const denoKeys = Object.keys(denoTransitions).sort();
  assert.deepEqual(denoKeys, nodeKeys, 'lifecycle.ts and lifecycle.js define different sets of states');

  for (const key of nodeKeys) {
    assert.deepEqual(
      [...denoTransitions[key]].sort(),
      [...TRANSITIONS[key]].sort(),
      `Transitions from ${key} differ between lifecycle.ts (${JSON.stringify(denoTransitions[key])}) and lifecycle.js (${JSON.stringify(TRANSITIONS[key])})`
    );
  }
});

// Same idea for the SQL migration's project_status_transitions seed data -
// this one can't be queried (no live Postgres), but the INSERT statement's
// literal values can still be extracted and compared.
test('CONSISTENCY: migration 003 project_status_transitions table matches lifecycle.js', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/003_lifecycle_states.sql'), 'utf-8');
  const valuesBlockMatch = sql.match(/insert into project_status_transitions[\s\S]*?values([\s\S]*?)on conflict/);
  assert.ok(valuesBlockMatch, 'could not find the INSERT...VALUES block in migration 003 - format may have changed');

  const pairRe = /\('(\w+)',\s*'(\w+)'\)/g;
  const sqlEdges = new Set();
  let m;
  while ((m = pairRe.exec(valuesBlockMatch[1])) !== null) {
    sqlEdges.add(`${m[1]}->${m[2]}`);
  }

  const jsEdges = new Set();
  for (const [from, tos] of Object.entries(TRANSITIONS)) {
    for (const to of tos) jsEdges.add(`${from}->${to}`);
  }

  assert.deepEqual([...sqlEdges].sort(), [...jsEdges].sort(), 'migration 003\'s transition table and lifecycle.js\'s TRANSITIONS graph have diverged');
});

// Fraud thresholds: the two magic numbers that actually matter for
// behavior parity between the SQLite demo and the (unexecuted) Supabase
// Edge Function version.
test('CONSISTENCY: fraud.ts thresholds match fraud.js exactly', () => {
  const nodeSource = fs.readFileSync(path.join(ROOT, 'src/lib/fraud.js'), 'utf-8');
  const denoSource = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/fraud.ts'), 'utf-8');

  const nodeMin = nodeSource.match(/MIN_SECONDS_PER_QUESTION\s*=\s*(\d+)/);
  const denoMin = denoSource.match(/MIN_SECONDS_PER_QUESTION\s*=\s*(\d+)/);
  const nodeMax = nodeSource.match(/MAX_RESPONSES_PER_USER_PER_DAY\s*=\s*(\d+)/);
  const denoMax = denoSource.match(/MAX_RESPONSES_PER_USER_PER_DAY\s*=\s*(\d+)/);

  assert.ok(nodeMin && denoMin && nodeMax && denoMax, 'could not extract threshold constants from one of the two files - format may have changed');
  assert.equal(denoMin[1], nodeMin[1], 'MIN_SECONDS_PER_QUESTION differs between fraud.js and fraud.ts');
  assert.equal(denoMax[1], nodeMax[1], 'MAX_RESPONSES_PER_USER_PER_DAY differs between fraud.js and fraud.ts');
});
