import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('business dashboard exposes every inline action used by generated markup', async () => {
  const source = await read('../public/js/supabase/business-page.js');
  const handlers = [...source.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map((match) => match[1]);
  const uniqueHandlers = [...new Set(handlers)];
  const globalBlock = source.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\);/);
  assert.ok(globalBlock, 'business dashboard must explicitly expose generated inline handlers');
  for (const handler of uniqueHandlers) {
    assert.match(globalBlock[1], new RegExp('\\b' + handler + '\\b'), handler + ' must be globally accessible');
  }
});

test('admin dashboard includes survey responses without requesting respondent identity', async () => {
  const html = await read('../public/supabase-admin/dashboard.html');
  const admin = await read('../public/js/supabase/admin.js');
  const controller = await read('../public/js/supabase/admin-page.js');
  assert.match(html, /data-tab="responses"/, 'admin needs a survey responses tab');
  assert.match(html, /id="tab-responses"/, 'admin needs the response panel');
  assert.match(controller, /admin\.listSurveyResponses\(\)/, 'response tab must load response data');
  assert.match(admin, /export async function listSurveyResponses\(/, 'admin data layer must implement response loading');
  assert.doesNotMatch(admin, /profiles\(full_name\)|select\('id, role, full_name, city, status/, 'admin queries must not request participant profile details');
});

test('public entry points route users to persistent Supabase-backed pages', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /href="\/supabase-login\.html"/, 'login should use Supabase auth');
  assert.match(html, /href="\/supabase-register-business\.html"/, 'business registration should use Supabase');
  assert.match(html, /href="\/supabase-register-participant\.html"/, 'participant registration should use Supabase');
});

test('participant registration handles email confirmation without forcing a dashboard redirect', async () => {
  const html = await read('../public/supabase-register-participant.html');
  assert.match(html, /needsEmailConfirmation/, 'signup must handle accounts that need email confirmation');
  assert.match(html, /const value = \(id\) => document\.getElementById\(id\)\.value/, 'form fields should be accessed explicitly inside the ES module');
  assert.match(html, /supabase-login\.html/, 'confirmed accounts should use the Supabase login route');
});

test('participant dashboard redirects unauthenticated and suspended users to Supabase login', async () => {
  const html = await read('../public/supabase-participant/dashboard.html');
  assert.doesNotMatch(html, /location\.href = '\/login\.html'/, 'legacy login route must not be used on the Supabase dashboard');
  assert.match(html, /location\.href = '\/supabase-login\.html'/, 'auth failures should route to Supabase login');
});

test('survey draft backend supports free token-mode drafts for unverified businesses', async () => {
  const source = await read('../supabase/functions/create-research-project/index.ts');
  assert.match(source, /reward_per_response_tokens/);
  assert.match(source, /reward_per_response_tokens: tokenMode \? tokenReward : null/);
  assert.match(source, /status: 'DRAFT'/);
  assert.doesNotMatch(source, /verification_status.*VERIFIED|Business must be verified/i, 'draft creation must not require verification or spend tokens');
  assert.match(source, /reward_per_response_tokens.*tokenReward/);
  assert.match(source, /tokenReward.*< 5/, 'the minimum participant reward is five tokens');
});

test('AI survey targeting respects the platform adult-participant requirement', async () => {
  const source = await read('../public/js/supabase/business-page.js');
  assert.match(source, /age < 18 \|\| age > 120/);
});
