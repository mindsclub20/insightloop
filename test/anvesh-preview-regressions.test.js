import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('shared login routes the database USER role to the participant workspace', () => {
  const html = read('public/supabase-login.html');
  assert.match(html, /role === 'PARTICIPANT' \|\| role === 'USER'/);
  assert.match(html, /supabase-participant\/dashboard\.html/);
});

test('research preview inline module parses as valid JavaScript', () => {
  const html = read('public/research-preview.html');
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, 'inline module script exists');
  const dir = mkdtempSync(join(tmpdir(), 'anvesh-preview-'));
  const file = join(dir, 'preview.mjs');
  try {
    writeFileSync(file, match[1]);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('research preview keeps draft saving local and exposes the local plan action', () => {
  const html = read('public/research-preview.html');
  assert.match(html, /\$\('researchForm'\)\.addEventListener\('submit'/);
  assert.match(html, /\$\('generateLocalPlan'\)\.addEventListener\('click'/);
  assert.match(html, /No backend changes were made/);
  assert.doesNotMatch(html, /Lo\$\('generateLocalPlan'\)/);
});

test('admin user list masks participant names and labels USER as Participant', () => {
  const page = read('public/js/supabase/admin-page.js');
  assert.match(page, /const isParticipant = u\.role === 'USER'/);
  assert.match(page, /const accountLabel = isParticipant \? 'Participant' : \(u\.full_name \|\| ''\)/);
  assert.match(page, /const roleLabel = isParticipant \? 'Participant' : u\.role/);
});

test('changed dashboard modules parse as valid JavaScript', () => {
  for (const path of [
    'public/js/supabase/admin-page.js',
    'public/js/supabase/business-page.js',
    'public/js/supabase/token-admin-page.js'
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'anvesh-module-'));
    const file = join(dir, 'module.mjs');
    try {
      writeFileSync(file, read(path));
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, path + ': ' + (result.stderr || result.stdout));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
