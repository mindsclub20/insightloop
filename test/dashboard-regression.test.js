import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('business dashboard exposes every inline action used by generated markup', async () => {
  const source = await read('../public/js/supabase/business-page.js');
  const handlers = [...source.matchAll(/onclick="([A-Za-z_$][\\w$]*)\\(/g)].map((match) => match[1]);
  const uniqueHandlers = [...new Set(handlers)];
  const globalBlock = source.match(/Object\\.assign\\(window,\\s*\\{([\\s\\S]*?)\\}\\);/);
  assert.ok(globalBlock, 'business dashboard must explicitly expose generated inline handlers');
  for (const handler of uniqueHandlers) {
    assert.match(globalBlock[1], new RegExp('\\\\b' + handler + '\\\\b'), handler + ' must be globally accessible');
  }
});

test('admin dashboard includes a response review panel without exposing respondent identity', async () => {
  const html = await read('../public/supabase-admin/dashboard.html');
  const admin = await read('../public/js/supabase/admin.js');
  assert.match(html, /data-tab="responses"/, 'admin needs an all-survey-responses tab');
  assert.match(html, /id="tab-responses"/, 'admin needs the response panel');
  assert.doesNotMatch(admin, /profiles\\(full_name\\)|select\\('id, role, full_name, city, status/, 'admin list queries must not request participant personal details');
});

test('public entry points route users to persistent Supabase-backed pages', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /href="\\/supabase-login\\.html"/, 'login should use Supabase auth');
  assert.match(html, /href="\\/supabase-register-business\\.html"/, 'business registration should use Supabase');
  assert.match(html, /href="\\/supabase-register-participant\\.html"/, 'participant registration should use Supabase');
});
