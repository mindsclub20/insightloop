// src/db.js
//
// NOTE ON DATABASE CHOICE:
// The production target for InsightLoop is Supabase/Postgres with Row Level
// Security (see /migrations/001_postgres_schema.sql and
// /migrations/002_rls_policies.sql for the real production schema + RLS).
//
// This dev/demo server uses Node's built-in `node:sqlite` so the MVP runs
// with ZERO external dependencies and no network access (no npm install,
// no hosted database required) — you can clone this and run it immediately.
// SQLite has no RLS, so authorization is enforced in the application layer
// (see src/lib/authz.js) as a direct stand-in for the Postgres RLS policies.
// This is called out explicitly in README.md as something that must be
// re-verified against real RLS policies before production use.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.INSIGHTLOOP_DB_PATH || path.join(DATA_DIR, 'insightloop.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER','BUSINESS','ADMIN','SUPER_ADMIN')) DEFAULT 'USER',
  full_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')) DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_range TEXT,
  gender TEXT,
  city TEXT,
  area TEXT,
  occupation_category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_interests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interests_tag ON user_interests(tag);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  gstin TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')) DEFAULT 'PENDING',
  city TEXT,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_user_id);

CREATE TABLE IF NOT EXISTS business_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER','EDITOR')) DEFAULT 'OWNER',
  UNIQUE(business_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON business_members(user_id);

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  template_type TEXT NOT NULL,
  objective TEXT,
  target_city TEXT NOT NULL,
  target_min_age INTEGER,
  target_max_age INTEGER,
  target_gender TEXT,
  target_tags TEXT NOT NULL DEFAULT '[]',
  sample_size INTEGER NOT NULL,
  budget_paise INTEGER NOT NULL,
  reward_per_response_paise INTEGER NOT NULL,
  deadline TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','ADMIN_REVIEW','APPROVED','ACTIVE','PAUSED','COMPLETED','REPORT_READY','ARCHIVED','REJECTED','CANCELLED')) DEFAULT 'DRAFT',
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_status_city ON research_projects(status, target_city);
CREATE INDEX IF NOT EXISTS idx_research_business ON research_projects(business_id);

CREATE TABLE IF NOT EXISTS survey_questions (
  id TEXT PRIMARY KEY,
  research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice','multi_choice','yes_no','rating_5','rating_10','short_text','long_text')),
  is_required INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_questions_project ON survey_questions(research_project_id);

CREATE TABLE IF NOT EXISTS question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  order_index INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_options_question ON question_options(question_id);

CREATE TABLE IF NOT EXISTS survey_responses (
  id TEXT PRIMARY KEY,
  research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL CHECK (status IN ('PENDING','VALID','FLAGGED','REJECTED')) DEFAULT 'PENDING',
  quality_score REAL,
  device_fingerprint TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(research_project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_responses_project_status ON survey_responses(research_project_id, status);
CREATE INDEX IF NOT EXISTS idx_responses_device ON survey_responses(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_responses_user ON survey_responses(user_id);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  selected_option_ids TEXT,
  text_answer TEXT,
  rating_value INTEGER
);
CREATE INDEX IF NOT EXISTS idx_answers_response ON answers(response_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);

CREATE TABLE IF NOT EXISTS response_quality (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL UNIQUE REFERENCES survey_responses(id) ON DELETE CASCADE,
  flag_reasons TEXT NOT NULL DEFAULT '[]',
  reviewed_by TEXT REFERENCES users(id),
  review_decision TEXT CHECK (review_decision IN ('VALID','REJECTED')),
  review_notes TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_paise INTEGER NOT NULL DEFAULT 0,
  pending_paise INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('SURVEY_REWARD','WITHDRAWAL','ADJUSTMENT','WITHDRAWAL_REVERSAL')),
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','CONFIRMED','PROCESSING','PAID','FAILED')) DEFAULT 'PENDING',
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON wallet_transactions(reference_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  upi_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','PROCESSING','PAID','FAILED','REJECTED')) DEFAULT 'REQUESTED',
  ledger_transaction_id TEXT REFERENCES wallet_transactions(id),
  processed_by TEXT REFERENCES users(id),
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

CREATE TABLE IF NOT EXISTS business_payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  research_project_id TEXT REFERENCES research_projects(id),
  amount_paise INTEGER NOT NULL,
  gateway_reference TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('INITIATED','MANUAL_PENDING','SUCCESS','FAILED','REFUNDED')) DEFAULT 'MANUAL_PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_business ON business_payments(business_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('USER','RESPONSE','BUSINESS')),
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH')) DEFAULT 'MEDIUM',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fraud_entity ON fraud_flags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fraud_resolved ON fraud_flags(resolved);

CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  old_values TEXT,
  new_values TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_logs(table_name, record_id);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  business_id TEXT REFERENCES businesses(id),
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','IN_PROGRESS','CLOSED')) DEFAULT 'OPEN',
  assigned_admin TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- _session_context is the SQLite/demo stand-in for Postgres's auth.uid():
-- a single-row table that server.js updates with the current request's
-- authenticated user id before invoking a route handler, so that database
-- TRIGGERS (below) can record who made a change without depending on any
-- route handler remembering to log it. See setCurrentActor() below and the
-- CONCURRENCY CAVEAT documented there — this is a demo-appropriate stand-in
-- for auth.uid(), not a production-grade equivalent.
CREATE TABLE IF NOT EXISTS _session_context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  actor_id TEXT
);
INSERT OR IGNORE INTO _session_context (id, actor_id) VALUES (1, NULL);
`;

db.exec(SCHEMA);

// ============================================================
// AUDIT TRIGGERS — executed and tested in this repo (see
// test/audit-triggers.test.js). These are the proof-of-concept for the
// equivalent (and equally load-bearing) Postgres triggers written in
// migrations/005_audit_triggers.sql, which use auth.uid() instead of the
// _session_context table below since Supabase provides the authenticated
// caller natively per-request without needing this workaround.
//
// The point of a DB-level trigger, here as in production: an audit_logs
// row is written whenever the tracked column changes, REGARDLESS of
// whether the route handler that made the change remembered to call
// logAdminAction(). A developer forgetting to log something can no longer
// silently produce an unaudited privileged action.
// ============================================================
const AUDIT_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS audit_user_role
AFTER UPDATE ON users WHEN NEW.role IS NOT OLD.role
BEGIN
  INSERT INTO audit_logs (id, actor_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    lower(hex(randomblob(16))),
    (SELECT actor_id FROM _session_context WHERE id = 1),
    'role_CHANGED', 'users', NEW.id,
    json_object('role', OLD.role), json_object('role', NEW.role)
  );
END;

CREATE TRIGGER IF NOT EXISTS audit_user_status
AFTER UPDATE ON users WHEN NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO audit_logs (id, actor_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    lower(hex(randomblob(16))),
    (SELECT actor_id FROM _session_context WHERE id = 1),
    'status_CHANGED', 'users', NEW.id,
    json_object('status', OLD.status), json_object('status', NEW.status)
  );
END;

CREATE TRIGGER IF NOT EXISTS audit_business_verification
AFTER UPDATE ON businesses WHEN NEW.verification_status IS NOT OLD.verification_status
BEGIN
  INSERT INTO audit_logs (id, actor_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    lower(hex(randomblob(16))),
    (SELECT actor_id FROM _session_context WHERE id = 1),
    'verification_status_CHANGED', 'businesses', NEW.id,
    json_object('verification_status', OLD.verification_status), json_object('verification_status', NEW.verification_status)
  );
END;

CREATE TRIGGER IF NOT EXISTS audit_project_status
AFTER UPDATE ON research_projects WHEN NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO audit_logs (id, actor_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    lower(hex(randomblob(16))),
    (SELECT actor_id FROM _session_context WHERE id = 1),
    'status_CHANGED', 'research_projects', NEW.id,
    json_object('status', OLD.status), json_object('status', NEW.status)
  );
END;

CREATE TRIGGER IF NOT EXISTS audit_withdrawal_status
AFTER UPDATE ON withdrawals WHEN NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO audit_logs (id, actor_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    lower(hex(randomblob(16))),
    (SELECT actor_id FROM _session_context WHERE id = 1),
    'status_CHANGED', 'withdrawals', NEW.id,
    json_object('status', OLD.status), json_object('status', NEW.status)
  );
END;

CREATE TRIGGER IF NOT EXISTS audit_response_review
AFTER UPDATE ON response_quality WHEN NEW.review_decision IS NOT OLD.review_decision
BEGIN
  INSERT INTO audit_logs (id, actor_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    lower(hex(randomblob(16))),
    (SELECT actor_id FROM _session_context WHERE id = 1),
    'review_decision_CHANGED', 'response_quality', NEW.id,
    json_object('review_decision', OLD.review_decision), json_object('review_decision', NEW.review_decision)
  );
END;

-- audit_logs is append-only: block UPDATE/DELETE at the trigger level too,
-- mirroring migrations/005_audit_triggers.sql's reject_audit_log_mutation().
CREATE TRIGGER IF NOT EXISTS block_audit_log_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER IF NOT EXISTS block_audit_log_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only: DELETE is not permitted');
END;
`;

db.exec(AUDIT_TRIGGERS);

// Sets the "current actor" for the DB triggers above to attribute the audit
// row to. Call this once per request, after resolving the authenticated
// user and before running any mutating queries.
//
// CONCURRENCY CAVEAT (demo-only limitation, does not apply to production):
// this is a single shared row, not a per-connection/per-transaction value.
// node:sqlite's DatabaseSync executes queries synchronously, and none of
// this app's route handlers await anything between setCurrentActor() and
// their database writes, so in practice request A's writes always land
// before request B's actor is set. But this is a real limitation of the
// pattern, not a guarantee — a production Postgres deployment does not
// have this problem because auth.uid() is derived from each request's own
// authenticated connection/JWT, not a shared mutable variable. This is
// exactly why migrations/005_audit_triggers.sql uses auth.uid() instead of
// reimplementing this table in Postgres.
export function setCurrentActor(userId) {
  db.prepare('UPDATE _session_context SET actor_id = ? WHERE id = 1').run(userId || null);
}

export function resetDatabaseForTests() {
  // Used only by the automated test suite to get a clean slate.
  // NOTE: audit_logs is deliberately excluded here - it is append-only (see
  // the block_audit_log_delete/update triggers below) even for test setup,
  // which is exactly the property under test in test/audit-triggers.test.js.
  // Tests that read audit_logs scope their queries by a fresh record_id per
  // test, so old rows accumulating across tests in the same file/process
  // don't affect correctness.
  const tables = [
    'sessions','support_tickets','admin_actions','fraud_flags',
    'notifications','business_payments','withdrawals','wallet_transactions',
    'wallets','response_quality','answers','survey_responses','question_options',
    'survey_questions','research_projects','business_members','businesses',
    'user_interests','profiles','users'
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t};`);
  db.exec(`UPDATE _session_context SET actor_id = NULL WHERE id = 1;`);
}
