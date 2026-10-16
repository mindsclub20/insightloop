// Estimate only the participant reward pool. The platform fee is not finalized
// and must never be invented or folded into this number.
export function estimateParticipantRewardBudget(sampleSize, rewardPerResponseRupees) {
  const count = Number(sampleSize);
  const rupees = Number(rewardPerResponseRupees);

  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('Sample size must be a positive whole number.');
  }
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new Error('Reward per response must be greater than zero.');
  }

  const rewardPerResponsePaise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(rewardPerResponsePaise) || rewardPerResponsePaise < 1) {
    throw new Error('Reward per response is outside the supported range.');
  }

  const totalRewardBudgetPaise = count * rewardPerResponsePaise;
  if (!Number.isSafeInteger(totalRewardBudgetPaise)) {
    throw new Error('The participant reward budget is too large.');
  }

  return { sampleSize: count, rewardPerResponsePaise, totalRewardBudgetPaise };
}
