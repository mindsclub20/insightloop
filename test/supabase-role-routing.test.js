import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardPath, SHARED_LOGIN_PATH } from '../public/js/supabase/role-routing.js';

test('participant role routes to the web participant dashboard', () => {
  assert.equal(getDashboardPath('USER'), '/supabase-participant/dashboard.html');
});

test('business role routes to the business dashboard', () => {
  assert.equal(getDashboardPath('BUSINESS'), '/supabase-business/dashboard.html');
});

test('admin roles route to the admin dashboard', () => {
  assert.equal(getDashboardPath('ADMIN'), '/supabase-admin/dashboard.html');
  assert.equal(getDashboardPath('SUPER_ADMIN'), '/supabase-admin/dashboard.html');
});

test('unknown or missing roles do not receive a dashboard route', () => {
  assert.equal(getDashboardPath('GUEST'), null);
  assert.equal(getDashboardPath(null), null);
});

test('all protected roles share one login route', () => {
  assert.equal(SHARED_LOGIN_PATH, '/supabase-login.html');
});
