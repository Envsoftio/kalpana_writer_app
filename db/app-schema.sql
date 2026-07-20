CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY CHECK (id = 'admin'),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  password_updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_audit_log_created_at
  ON app_audit_log (created_at);

CREATE INDEX IF NOT EXISTS idx_app_audit_log_entity
  ON app_audit_log (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS app_export_job (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'admin',
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  file_name TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_app_export_job_status_created_at
  ON app_export_job (status, created_at);
