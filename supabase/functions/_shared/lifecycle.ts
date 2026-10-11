// supabase/functions/_shared/lifecycle.ts
//
// WRITTEN, NOT EXECUTED. Must stay identical to src/lib/lifecycle.js's
// TRANSITIONS object and migrations/003_lifecycle_states.sql's
// project_status_transitions table — three independent copies of the same
// graph across two languages and a database table. This triplication is a
// real design cost worth naming, not hiding: a production build should
// pick ONE source of truth (most naturally the Postgres table, since 003's
// trigger already enforces it at the database level regardless of what any
// application code believes) and have both the Node demo and this Edge
// Function read it from there instead of hardcoding it three times. Left
// as three copies here because unifying them requires the live database
// this sandbox doesn't have access to — flagged as follow-up work, not
// done silently.

export const TRANSITIONS: Record<string, string[]> = {
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

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}
