-- Regras e fila de mensagens. Segredos dos provedores ficam apenas no ambiente do servidor.
CREATE TABLE team_permissions_messages (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN
    ('dashboard', 'clients', 'events', 'calendar', 'finance', 'inventory', 'suppliers', 'messages')),
  can_view INTEGER NOT NULL DEFAULT 0 CHECK (can_view IN (0, 1)),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  PRIMARY KEY (user_id, module)
);
INSERT INTO team_permissions_messages (user_id, module, can_view, can_edit)
  SELECT user_id, module, can_view, can_edit FROM team_permissions;
DROP TABLE team_permissions;
ALTER TABLE team_permissions_messages RENAME TO team_permissions;

CREATE TABLE message_preferences (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  email_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (email_opt_in IN (0, 1)),
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_opt_in IN (0, 1)),
  consent_source TEXT NOT NULL DEFAULT 'portal',
  updated_at TEXT NOT NULL
);

CREATE TABLE message_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  occasion TEXT NOT NULL CHECK (occasion IN ('event_start', 'installment_due')),
  channel TEXT NOT NULL CHECK (channel IN ('internal', 'email', 'whatsapp')),
  offset_minutes INTEGER NOT NULL,
  send_time TEXT NOT NULL DEFAULT '09:00',
  event_type TEXT NOT NULL DEFAULT '',
  subject_template TEXT NOT NULL DEFAULT '',
  body_template TEXT NOT NULL DEFAULT '',
  whatsapp_template_name TEXT NOT NULL DEFAULT '',
  whatsapp_language TEXT NOT NULL DEFAULT 'pt_BR',
  whatsapp_variables_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE message_jobs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES message_rules(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('event', 'installment')),
  source_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('internal', 'email', 'whatsapp')),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'cancelled')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  whatsapp_variables_json TEXT NOT NULL DEFAULT '[]',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  retry_safe INTEGER NOT NULL DEFAULT 1 CHECK (retry_safe IN (0, 1)),
  last_error TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT,
  started_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (rule_id, source_type, source_id, client_id, scheduled_at, channel)
);
CREATE INDEX idx_message_jobs_due ON message_jobs(status, scheduled_at);
CREATE INDEX idx_message_jobs_client ON message_jobs(client_id, channel, status, sent_at);
CREATE INDEX idx_message_jobs_provider ON message_jobs(provider_message_id);

CREATE TABLE message_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES message_jobs(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  provider_message_id TEXT,
  error TEXT NOT NULL DEFAULT '',
  UNIQUE (job_id, attempt_no)
);
