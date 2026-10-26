export const RESEARCH_WORKLOADS = Object.freeze({
  web_research: 0,
  research_planning: 1,
  survey_design: 2,
  evidence_analysis: 3,
  report_generation: 4,
  quality_review: 5,
});

export const GEMINI_SECRET_NAMES = Object.freeze([
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_API_KEY_6',
]);

export function getApiKeyCandidates(env, workload) {
  const start = RESEARCH_WORKLOADS[workload];
  if (start === undefined) throw new Error('Unsupported AI workload.');
  return GEMINI_SECRET_NAMES
    .map((name, index) => ({ name, value: typeof env?.[name] === 'string' ? env[name].trim() : '', index }))
    .filter((entry) => entry.value.length > 0)
    .sort((a, b) => ((a.index - start + 6) % 6) - ((b.index - start + 6) % 6))
    .map(({ name, value }) => ({ name, value }));
}

export function calculateResearchBudget(sampleSize, rewardPerResponse, platformFee = 100) {
  if (!Number.isInteger(sampleSize) || sampleSize < 10 || sampleSize > 500) {
    throw new Error('Sample size must be between 10 and 500.');
  }
  if (!Number.isInteger(rewardPerResponse) || rewardPerResponse < 5 || rewardPerResponse > 1000000) {
    throw new Error('Reward must be a whole number of at least 5 tokens per response.');
  }
  if (!Number.isInteger(platformFee) || platformFee < 0) {
    throw new Error('Platform fee must be a non-negative whole number of tokens.');
  }
  const participantRewards = sampleSize * rewardPerResponse;
  return {
    sampleSize,
    rewardPerResponse,
    participantRewards,
    platformFee,
    totalTokensRequired: participantRewards + platformFee,
    providerChargesIncluded: false,
    note: 'AI/search provider charges are not included in token reservations; only participant rewards and the platform fee are counted here.',
  };
}

export function parseJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('AI returned an empty response.');
  const cleaned = text.trim().replace(/^\u0060{3}(?:json)?\s*/i, '').replace(/\s*\u0060{3}$/, '');
  const value = JSON.parse(cleaned);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI response must be a JSON object.');
  return value;
}

export function normalizeGroundingSources(metadata) {
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const seen = new Set();
  return chunks.flatMap((chunk) => {
    const web = chunk?.web;
    if (!web || typeof web.uri !== 'string' || !/^https?:\/\//i.test(web.uri)) return [];
    const url = web.uri.trim();
    if (seen.has(url)) return [];
    seen.add(url);
    return [{ title: typeof web.title === 'string' && web.title.trim() ? web.title.trim().slice(0, 240) : url, url }];
  }).slice(0, 12);
}
