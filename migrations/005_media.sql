-- Arquivos do evento ficam fora de public/ e só são servidos por rota autorizada.
CREATE TABLE media_files (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inspiration', 'contract')),
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_media_files_event ON media_files(event_id, created_at);

CREATE TABLE event_inspirations (
  file_id TEXT PRIMARY KEY REFERENCES media_files(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('event', 'client', 'internal')),
  client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT
);
CREATE INDEX idx_event_inspirations_client ON event_inspirations(client_id);

CREATE TABLE event_contracts (
  file_id TEXT PRIMARY KEY REFERENCES media_files(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  signature_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (signature_status IN ('pending', 'signed_manual')),
  shared_with_client INTEGER NOT NULL DEFAULT 0 CHECK (shared_with_client IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, file_id)
);
CREATE INDEX idx_event_contracts_client ON event_contracts(client_id, shared_with_client);
