import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTokenBudget } from '../public/js/supabase/token-budget.js';
test('budget includes the fixed platform fee', () => assert.equal(calculateTokenBudget(200, 5).totalRequired, 1100));
