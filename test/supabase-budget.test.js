import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateParticipantRewardBudget } from '../public/js/supabase/budget.js';

test('reward budget is participant rewards only and does not invent a platform fee', () => {
  assert.deepEqual(estimateParticipantRewardBudget(100, 5), {
    sampleSize: 100,
    rewardPerResponsePaise: 500,
    totalRewardBudgetPaise: 50000,
  });
});

test('reward budget rejects invalid sample sizes', () => {
  assert.throws(() => estimateParticipantRewardBudget(0, 5), /sample size/i);
  assert.throws(() => estimateParticipantRewardBudget(-1, 5), /sample size/i);
});

test('reward budget rejects invalid or zero per-response rewards', () => {
  assert.throws(() => estimateParticipantRewardBudget(100, 0), /reward/i);
  assert.throws(() => estimateParticipantRewardBudget(100, -1), /reward/i);
  assert.throws(() => estimateParticipantRewardBudget(100, Number.NaN), /reward/i);
});
