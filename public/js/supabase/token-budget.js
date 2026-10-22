export function calculateTokenBudget(participantCount, rewardPerParticipant) {
  if (!Number.isInteger(participantCount) || participantCount < 10 || participantCount > 500) throw new Error('Participant count must be between 10 and 500.');
  if (!Number.isInteger(rewardPerParticipant)) throw new Error('Reward must be a whole number of tokens.');
  if (rewardPerParticipant < 5) throw new Error('Reward must be at least 5 tokens per participant.');
  const participantRewardBudget = participantCount * rewardPerParticipant;
  const platformFee = 100;
  return { participantCount, rewardPerParticipant, participantRewardBudget, platformFee, totalRequired: participantRewardBudget + platformFee };
}
