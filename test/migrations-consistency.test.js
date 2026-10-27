import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function readMigration(name) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf-8');
}

const m001 = readMigration('001_postgres_schema.sql');
const m002 = readMigration('002_rls_policies.sql');
const m004 = readMigration('004_rls_hardening.sql');
const allMigrations = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

// Tables/things Postgres or Supabase provides that won't appear in 001's
// CREATE TABLE list - referencing these is legitimate, not a typo.
const EXTERNAL_TABLES = new Set(['auth.users', 'storage.objects', 'storage.buckets']);

function extractCreatedTables(sql) {
  const names = new Set();
  const re = /create table (?:if not exists )?(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) names.add(m[1]);
  return names;
}

test('SQL CONSISTENCY: every table referenced across all migrations was actually created in 001 (or is a known external table)', () => {
  const definedTables = extractCreatedTables(m001);
  assert.ok(definedTables.size >= 19, `expected at least 19 tables from 001, found ${definedTables.size} - extraction regex may be wrong`);

  const problems = [];
  for (const file of allMigrations) {
    if (file === '001_postgres_schema.sql') continue; // that's the source of truth being checked against
    const sql = readMigration(file);
    // Matches "on <table>", "references <table>", "from <table>" style mentions.
    const re = /\b(?:on|references|from|into|update|table)\s+(\w+(?:\.\w+)?)\b/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const name = m[1].toLowerCase();
      // Filter out SQL keywords and non-table identifiers this loose regex
      // will also catch (function names, column names in "update ... set").
      if (['public', 'conflict', 'exists', 'each', 'row'].includes(name)) continue;
      if (EXTERNAL_TABLES.has(name)) continue;
      if (definedTables.has(name)) continue;
      // PL/pgSQL local variables (this project's convention prefixes them
      // v_) get caught by the "into" branch of the regex - "select ...
      // into v_wallet" is a variable assignment, not a table reference.
      // Filtering these out rather than removing "into" from the keyword
      // list entirely, since "insert into <table>" is a real, valuable
      // case to keep checking.
      if (/^v_\w+$/.test(name)) continue;
      // Could be a function name (e.g. "on research_projects" is real, but
      // this regex also matches function-call-adjacent text) - only flag
      // names that look like they were meant as our own snake_case table
      // names (contain an underscore, all lowercase) to keep false
      // positives low while still catching a genuine typo'd table name.
      if (/^[a-z_]+$/.test(name) && name.includes('_') && !problems.some((p) => p.name === name && p.file === file)) {
        problems.push({ file, name });
      }
    }
  }

  // Known-fine non-table snake_case identifiers this loose regex will flag as false positives.
  const KNOWN_FALSE_POSITIVES = new Set([
    'row_security', 'each_row', 'update_project_status_transitions', // trigger timing words / composite matches
    'current_user_role', 'project_status_transitions', 'jsonb_array_elements', // SQL set-returning function / table added in 003
  ]);
  const realProblems = problems.filter((p) => !KNOWN_FALSE_POSITIVES.has(p.name) && p.name !== 'project_status_transitions');

  assert.deepEqual(realProblems, [], `Found references to tables never created in 001: ${JSON.stringify(realProblems)}`);
});

test('SQL CONSISTENCY: project_status_transitions (created in 003, not 001) is referenced correctly by 003 and only 003', () => {
  assert.ok(m001.includes('project_status_transitions') === false, '001 should be immutable and not know about a table added in 003');
  const m003 = readMigration('003_lifecycle_states.sql');
  assert.ok(m003.includes('create table if not exists project_status_transitions'));
});

test('SQL CONSISTENCY: every "drop policy if exists" in 004 has a matching "create policy" of the same name somewhere in 001-004', () => {
  const dropRe = /drop policy if exists "([^"]+)" on (\w+)/gi;
  const combined = m001 + '\n' + m002;
  let m;
  const missing = [];
  while ((m = dropRe.exec(m004)) !== null) {
    const [, policyName, table] = m;
    const createPattern = new RegExp(`create policy "${policyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" on ${table}`, 'i');
    if (!createPattern.test(combined)) missing.push({ policyName, table });
  }
  assert.deepEqual(missing, [], `004 drops a policy that was never created under that exact name/table: ${JSON.stringify(missing)}`);
});

test('SQL CONSISTENCY: every function referenced in a GRANT/REVOKE was actually defined with CREATE FUNCTION somewhere', () => {
  const problems = [];
  for (const file of allMigrations) {
    const sql = readMigration(file);
    const grantRe = /(?:grant execute on function|revoke all on function)\s+(\w+)\(/gi;
    let m;
    while ((m = grantRe.exec(sql)) !== null) {
      const fnName = m[1];
      const definedAnywhere = allMigrations.some((f) => {
        const s = readMigration(f);
        return new RegExp(`create (?:or replace )?function ${fnName}\\(`, 'i').test(s);
      });
      if (!definedAnywhere) problems.push({ file, fnName });
    }
  }
  assert.deepEqual(problems, [], `GRANT/REVOKE references a function never defined: ${JSON.stringify(problems)}`);
});

test('SQL CONSISTENCY: the CHECK constraint enum values on research_projects.status (001) cover every status migration 003 adds transitions for', () => {
  const checkMatch = m001.match(/status project_status not null default 'DRAFT'/);
  // 001 defines status via the project_status ENUM TYPE (not an inline CHECK) -
  // confirm that type declaration lists exactly the pre-003 states, and that
  // 003 explicitly adds the three new ones via ALTER TYPE rather than
  // silently assuming they exist.
  const enumMatch = m001.match(/create type project_status as enum \(([^)]+)\)/i);
  assert.ok(enumMatch, 'could not find the project_status enum definition in 001');
  const baseStates = enumMatch[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(baseStates.sort(), ['DRAFT', 'SUBMITTED', 'ADMIN_REVIEW', 'APPROVED', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'REJECTED'].sort());

  const m003 = readMigration('003_lifecycle_states.sql');
  for (const newState of ['PAUSED', 'CANCELLED', 'REPORT_READY']) {
    assert.ok(m003.includes(`add value if not exists '${newState}'`), `003 should ALTER TYPE to add ${newState}`);
  }
});
