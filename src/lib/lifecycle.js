// src/lib/lifecycle.js
//
// Single source of truth for which research_projects.status transitions are
// legal. This is the application-layer twin of the transition-guard trigger
// in migrations/003_lifecycle_states.sql (enforce_project_status_transition)
// - the graph below is written to match that SQL table exactly. If you
// change one, change the other; a mismatch means the demo would allow a
// transition production would reject, or vice versa.
//
// This module answers ONLY "is X -> Y a legal shape of transition at all".
// It does not answer "is THIS caller allowed to perform it" - that remains
// a per-route authorization check (business owns it / is admin), exactly as
// migrations/004_rls_hardening.sql keeps the transition-shape trigger and
// the who-can-do-it RLS policies as two separate, independently reviewable
// concerns.

export const TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['ADMIN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
  ADMIN_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['REPORT_READY', 'ARCHIVED'],
  REPORT_READY: ['ARCHIVED'],
  ARCHIVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export class IllegalTransitionError extends Error {
  constructor(from, to) {
    super(`Illegal study status transition: ${from} -> ${to}`);
    this.status = 400;
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
