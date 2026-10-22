import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTokenBudget } from '../public/js/supabase/token-budget.js';

test('budget includes the fixed platform fee', () => {
  assert.equal(calculateTokenBudget(200, 5).totalRequired, 1100);
});

test('supports a higher business-selected reward', () => {
  assert.equal(calculateTokenBudget(200, 10).totalRequired, 2100);
});

test('rejects participant counts outside 10–500', () => {
  assert.throws(() => calculateTokenBudget(9, 5), /10 and 500/);
  assert.throws(() => calculateTokenBudget(501, 5), /10 and 500/);
});

test('rejects rewards below 5 tokens and fractional rewards', () => {
  assert.throws(() => calculateTokenBudget(100, 4), /at least 5/);
  assert.throws(() => calculateTokenBudget(100, 5.5), /whole number/);
});
