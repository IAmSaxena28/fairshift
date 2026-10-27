/** FairShift schema. Money columns are integer paise; instants are integer UTC epoch milliseconds. */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  industry TEXT NOT NULL CHECK (industry IN ('construction', 'college')),
  time_zone TEXT NOT NULL,
  -- Public code used by the confidential report form. Knowing it reveals nothing about any worker.
  report_code TEXT NOT NULL UNIQUE,
  -- Sites with fewer workers than this are not named on confidential reports.
  min_group_size INTEGER NOT NULL DEFAULT 5,
  urgent_ack_hours INTEGER NOT NULL DEFAULT 4
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  site_id INTEGER REFERENCES sites(id),
  role TEXT NOT NULL CHECK (role IN ('worker', 'admin')),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  pay_group TEXT,
  pay_basis TEXT CHECK (pay_basis IN ('hourly', 'monthly')),
  rate_paise INTEGER,
  employed_from TEXT,
  lang TEXT NOT NULL DEFAULT 'en'
);

-- Pay rules are versioned: a change inserts a new row, earlier calculations keep their version.
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  pay_group TEXT NOT NULL,
  version INTEGER NOT NULL,
  -- First pay period ("YYYY-MM") this version applies to.
  effective_period TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  UNIQUE (org_id, pay_group, version)
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  site_id INTEGER REFERENCES sites(id),
  date TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS shifts_user_date ON shifts (user_id, date);

-- Append-only. Corrections add a "void" event and a replacement; nothing is updated in place.
CREATE TABLE IF NOT EXISTS attendance_events (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('check_in', 'check_out', 'void')),
  at INTEGER NOT NULL,
  target_id INTEGER REFERENCES attendance_events(id),
  source TEXT NOT NULL CHECK (source IN ('worker', 'admin_correction', 'seed')),
  recorded_at INTEGER NOT NULL,
  recorded_by INTEGER REFERENCES users(id),
  reason TEXT
);
CREATE INDEX IF NOT EXISTS attendance_user_at ON attendance_events (user_id, at);

CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  period TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- Versioned: a revision inserts a new row pointing at the one it supersedes.
CREATE TABLE IF NOT EXISTS payroll_records (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  period TEXT NOT NULL,
  version INTEGER NOT NULL,
  base_paise INTEGER NOT NULL,
  overtime_paise INTEGER NOT NULL,
  night_allowance_paise INTEGER NOT NULL,
  adjustments_paise INTEGER NOT NULL,
  gross_paise INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('calculated', 'approved', 'paid')),
  supersedes_id INTEGER REFERENCES payroll_records(id),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, period, version),
  CHECK (gross_paise = base_paise + overtime_paise + night_allowance_paise + adjustments_paise)
);

CREATE TABLE IF NOT EXISTS correction_cases (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  period TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pay', 'attendance')),
  status TEXT NOT NULL CHECK (status IN ('open', 'under_review', 'resolved')),
  outcome TEXT CHECK (outcome IN ('corrected', 'no_change')),
  worker_note TEXT,
  -- Snapshot of what the worker saw when asking, so later changes cannot rewrite the question.
  expected_paise INTEGER,
  recorded_paise INTEGER,
  check_in_event_id INTEGER REFERENCES attendance_events(id),
  proposed_check_out_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Confidential reports have no reporter column filled and no precise creation time.
CREATE TABLE IF NOT EXISTS safety_cases (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  site_id INTEGER REFERENCES sites(id),
  reporter_user_id INTEGER REFERENCES users(id),
  confidential INTEGER NOT NULL CHECK (confidential IN (0, 1)),
  tracking_hash TEXT UNIQUE,
  category TEXT NOT NULL,
  urgent INTEGER NOT NULL CHECK (urgent IN (0, 1)),
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'acknowledged', 'under_review', 'action_taken', 'resolved')),
  created_on TEXT NOT NULL,
  created_at INTEGER,
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (confidential = 0 OR (reporter_user_id IS NULL AND created_at IS NULL AND tracking_hash IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS case_events (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  case_type TEXT NOT NULL CHECK (case_type IN ('correction', 'safety')),
  case_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  -- Shown to the person who raised the case.
  public INTEGER NOT NULL DEFAULT 1,
  actor_user_id INTEGER REFERENCES users(id),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('worker', 'admin', 'reporter', 'system')),
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS case_events_case ON case_events (case_type, case_id);

-- Hash-chained per organisation: each row commits to the previous row's hash.
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (org_id, seq)
);
`;
