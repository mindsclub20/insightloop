// src/lib/matching.js
//
// P0 matching is deliberately simple and reliable: a straightforward
// attribute filter, not an ML/AI recommender. This mirrors the brief's
// explicit instruction to not over-build matching for the first version.

import { db } from '../db.js';

function ageRangeOverlaps(userAgeRange, minAge, maxAge) {
  if (!minAge && !maxAge) return true;
  if (!userAgeRange) return false;
  // userAgeRange stored like "18-25"
  const [uMin, uMax] = userAgeRange.split('-').map(Number);
  if (Number.isNaN(uMin) || Number.isNaN(uMax)) return true;
  const lo = minAge ?? 0;
  const hi = maxAge ?? 200;
  return uMax >= lo && uMin <= hi;
}

export function isEligible(profile, userTags, project) {
  if (!profile) return { eligible: false, reason: 'No profile found' };
  if (profile.city && project.target_city && profile.city.toLowerCase() !== project.target_city.toLowerCase()) {
    return { eligible: false, reason: `Study is for ${project.target_city}, your profile city is ${profile.city}` };
  }
  if (!ageRangeOverlaps(profile.age_range, project.target_min_age, project.target_max_age)) {
    return { eligible: false, reason: `Study targets ages ${project.target_min_age}-${project.target_max_age}` };
  }
  if (project.target_gender && project.target_gender !== 'any' && profile.gender !== project.target_gender) {
    return { eligible: false, reason: `Study targets gender: ${project.target_gender}` };
  }
  const requiredTags = JSON.parse(project.target_tags || '[]');
  if (requiredTags.length > 0) {
    const hasOverlap = requiredTags.some(t => userTags.includes(t));
    if (!hasOverlap) {
      return { eligible: false, reason: `Study requires interest in: ${requiredTags.join(', ')}` };
    }
  }
  return { eligible: true, reason: null };
}

// Returns all ACTIVE studies the given user is currently eligible for and
// has not already responded to.
export function findEligibleStudies(userId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const userTags = db.prepare('SELECT tag FROM user_interests WHERE user_id = ?').all(userId).map(r => r.tag);
  const activeProjects = db.prepare(`SELECT * FROM research_projects WHERE status = 'ACTIVE'`).all();
  const alreadyResponded = new Set(
    db.prepare('SELECT research_project_id FROM survey_responses WHERE user_id = ?').all(userId)
      .map(r => r.research_project_id)
  );

  return activeProjects
    .filter(p => !alreadyResponded.has(p.id))
    .map(p => ({ project: p, eligibility: isEligible(profile, userTags, p) }))
    .filter(r => r.eligibility.eligible)
    .map(r => r.project);
}
