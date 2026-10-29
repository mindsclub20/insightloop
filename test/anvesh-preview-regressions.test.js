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

test('business results buttons use delegated events and avoid textarea type assignment', () => {
  const page = read('public/js/supabase/business-page.js');
  assert.match(page, /document\.addEventListener\('click', \(event\) =>/);
  assert.match(page, /data-view-results/);
  assert.match(page, /if \(input\.tagName === 'INPUT'\) input\.type = step\.type \|\| 'text'/);
  assert.doesNotMatch(page, /^\s*input\.type = step\.type \|\| 'text';$/m);
});

test('token admin masks participant names in balances and transaction labels', () => {
  const page = read('public/js/supabase/token-admin-page.js');
  assert.match(page, /if \(account\.role === 'USER'\) return 'Participant'/);
  assert.match(page, /account\.role !== 'USER' \? \(account\.full_name \|\| ''\)/);
  assert.match(page, /accountLabel\(byId\.get\(t\.recipient_user_id\)\)/);
  assert.match(page, /accountLabel\(byId\.get\(t\.sender_user_id\)\)/);
});

test('participant survey cards display token rewards instead of zero cash rewards', () => {
  const data = read('public/js/supabase/participant.js');
  const page = read('public/supabase-participant/surveys.html');
  assert.match(data, /reward_per_response_tokens/);
  assert.match(page, /function rewardLabel\(study\)/);
  assert.match(page, /return tokens\.toLocaleString\('en-IN'\) \+ ' internal tokens'/);
  assert.match(page, /escapeHtml\(rewardLabel\(study\)\)/);
});

test('token-funded survey submissions route through the atomic database RPC', () => {
  const handler = read('supabase/functions/submit-survey-response/index.ts');
  assert.match(handler, /const tokenMode = project\.token_funding_status/);
  assert.match(handler, /admin\.rpc\('submit_token_funded_survey_response'/);
  assert.match(handler, /Survey response and reward were rolled back/);
  assert.match(handler, /if \(!result\?\.success \|\| !result\?\.responseId\)/);
});

test('atomic token submission migration groups response, answers, reward and budget in one transaction', () => {
  const migration = read('migrations/026_atomic_token_survey_submission.sql');
  assert.match(migration, /create or replace function public\.submit_token_funded_survey_response/);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /insert into public\.survey_responses/);
  assert.match(migration, /insert into public\.answers/);
  assert.match(migration, /insert into public\.token_transactions/);
  assert.match(migration, /update public\.token_wallets/);
  assert.match(migration, /update public\.research_projects/);
  assert.match(migration, /revoke all on function public\.submit_token_funded_survey_response/);
  assert.match(migration, /to service_role/);
});


test('business research dashboard keeps its assistant and study details in the same responsive workspace', () => {
  const html = read('public/supabase-business/dashboard.html');
  const workspaceStart = html.indexOf('<div class="dashboard-workspace">');
  const assistant = html.indexOf('id="aiSurveyCard"', workspaceStart);
  const details = html.indexOf('id="template_type"', workspaceStart);
  const workspaceEnd = html.indexOf('<div id="draftBuilder"></div>', details);
  assert.ok(workspaceStart >= 0 && assistant > workspaceStart && details > assistant && workspaceEnd > details);
  assert.doesNotMatch(html, /<\/div>\s*<div class="card" style="max-width:560px;">/);
});

test('business research dashboard hero and AI assistant use the navy/teal UI theme', () => {
  const css = read('public/css/research-workspace.css');
  assert.match(css, /\.dashboard-intro\s*\{[^}]*background:linear-gradient\(125deg,#101d3b,#203b67 68%,#087e8b\)!important/s);
  assert.match(css, /#tab-create #aiSurveyCard\s*\{[^}]*background:linear-gradient\(150deg,#fff 0%,#f5f8fc 70%,#e8fbfa 100%\)!important/s);
});
