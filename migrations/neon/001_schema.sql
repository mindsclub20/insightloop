-- InsightLoop PostgreSQL schema for Neon.
-- This schema is intentionally independent of Supabase auth.users/auth.uid().
-- Application authentication remains in the Node API and sessions table.
-- IDs are TEXT to preserve the existing application's ID format.
BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','BUSINESS','ADMIN','SUPER_ADMIN')),
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_range TEXT, gender TEXT, city TEXT, area TEXT, occupation_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_interests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tag TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interests_tag ON user_interests(tag);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL, gstin TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')),
  city TEXT, category TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_user_id);
CREATE TABLE IF NOT EXISTS business_members (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','EDITOR')), UNIQUE(business_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON business_members(user_id);

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL, template_type TEXT NOT NULL, objective TEXT, target_city TEXT NOT NULL,
  target_min_age INTEGER, target_max_age INTEGER, target_gender TEXT, target_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_size INTEGER NOT NULL, budget_paise BIGINT NOT NULL, reward_per_response_paise BIGINT NOT NULL,
  deadline TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','ADMIN_REVIEW','APPROVED','ACTIVE','PAUSED','COMPLETED','REPORT_READY','ARCHIVED','REJECTED','CANCELLED')),
  rejection_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_status_city ON research_projects(status,target_city);
CREATE INDEX IF NOT EXISTS idx_research_business ON research_projects(business_id);

CREATE TABLE IF NOT EXISTS survey_questions (
  id TEXT PRIMARY KEY, research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL, question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice','multi_choice','yes_no','rating_5','rating_10','short_text','long_text')),
  is_required BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_questions_project ON survey_questions(research_project_id);
CREATE TABLE IF NOT EXISTS question_options (
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL, order_index INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_options_question ON question_options(question_id);

CREATE TABLE IF NOT EXISTS survey_responses (
  id TEXT PRIMARY KEY, research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ, duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VALID','FLAGGED','REJECTED')),
  quality_score DOUBLE PRECISION, device_fingerprint TEXT, ip_address TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(research_project_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_responses_project_status ON survey_responses(research_project_id,status);
CREATE INDEX IF NOT EXISTS idx_responses_device ON survey_responses(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_responses_user ON survey_responses(user_id);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY, response_id TEXT NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  selected_option_ids JSONB, text_answer TEXT, rating_value INTEGER
);
CREATE INDEX IF NOT EXISTS idx_answers_response ON answers(response_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE TABLE IF NOT EXISTS response_quality (
  id TEXT PRIMARY KEY, response_id TEXT NOT NULL UNIQUE REFERENCES survey_responses(id) ON DELETE CASCADE,
  flag_reasons JSONB NOT NULL DEFAULT '[]'::jsonb, reviewed_by TEXT REFERENCES users(id),
  review_decision TEXT CHECK (review_decision IN ('VALID','REJECTED')), review_notes TEXT, reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  pending_paise BIGINT NOT NULL DEFAULT 0 CHECK (pending_paise >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('SURVEY_REWARD','WITHDRAWAL','ADJUSTMENT','WITHDRAWAL_REVERSAL')),
  amount_paise BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','PROCESSING','PAID','FAILED')),
  reference_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON wallet_transactions(reference_id);
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0), upi_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PROCESSING','PAID','FAILED','REJECTED')),
  ledger_transaction_id TEXT REFERENCES wallet_transactions(id), processed_by TEXT REFERENCES users(id), admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE TABLE IF NOT EXISTS business_payments (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  research_project_id TEXT REFERENCES research_projects(id), amount_paise BIGINT NOT NULL,
  gateway_reference TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'MANUAL_PENDING' CHECK (status IN ('INITIATED','MANUAL_PENDING','SUCCESS','FAILED','REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_business ON business_payments(business_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,read_at);
CREATE TABLE IF NOT EXISTS fraud_flags (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK (entity_type IN ('USER','RESPONSE','BUSINESS')),
  entity_id TEXT NOT NULL, reason TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  resolved BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fraud_entity ON fraud_flags(entity_type,entity_id);
CREATE INDEX IF NOT EXISTS idx_fraud_resolved ON fraud_flags(resolved);
CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id), action_type TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, table_name TEXT NOT NULL,
  record_id TEXT, old_values JSONB, new_values JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_logs(table_name,record_id);
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), business_id TEXT REFERENCES businesses(id),
  subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','CLOSED')),
  assigned_admin TEXT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
COMMIT;
