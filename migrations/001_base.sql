CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  job_title TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'team', 'client')),
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_clients_email ON clients(email COLLATE NOCASE);

CREATE TABLE team_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('dashboard', 'clients', 'events', 'calendar')),
  can_view INTEGER NOT NULL DEFAULT 0 CHECK (can_view IN (0, 1)),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  PRIMARY KEY (user_id, module)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('casamento', 'aniversario', 'corporativo', 'outro')),
  status TEXT NOT NULL CHECK (status IN ('orcamento', 'negociacao', 'contratado', 'em_execucao', 'concluido', 'cancelado')),
  start_at TEXT NOT NULL,
  end_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  guest_estimated INTEGER,
  guest_confirmed INTEGER,
  ceremony_name TEXT NOT NULL DEFAULT '',
  reception_name TEXT NOT NULL DEFAULT '',
  ceremony_address TEXT NOT NULL DEFAULT '',
  reception_address TEXT NOT NULL DEFAULT '',
  ceremony_map_url TEXT NOT NULL DEFAULT '',
  reception_map_url TEXT NOT NULL DEFAULT '',
  address_line TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  responsible_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_events_start_at ON events(start_at);
CREATE INDEX idx_events_status ON events(status);

CREATE TABLE event_clients (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, client_id)
);
CREATE INDEX idx_event_clients_client ON event_clients(client_id, event_id);

CREATE TABLE event_team (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_event_team_user ON event_team(user_id, event_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_invitations_expiry ON invitations(expires_at);

CREATE TABLE team_invitations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE auth_attempts (
  attempt_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id, created_at);
