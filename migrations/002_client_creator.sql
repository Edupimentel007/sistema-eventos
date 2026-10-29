ALTER TABLE clients ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_clients_created_by ON clients(created_by);
