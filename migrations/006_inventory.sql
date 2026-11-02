-- Diretório interno de fornecedores e controle de acervo. Quantidades são unidades
-- inteiras. Movimentos e reservas preservam histórico; arquivos ficam fora de public/.
CREATE TABLE team_permissions_inventory (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN
    ('dashboard', 'clients', 'events', 'calendar', 'finance', 'inventory', 'suppliers')),
  can_view INTEGER NOT NULL DEFAULT 0 CHECK (can_view IN (0, 1)),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  PRIMARY KEY (user_id, module)
);
INSERT INTO team_permissions_inventory (user_id, module, can_view, can_edit)
  SELECT user_id, module, can_view, can_edit FROM team_permissions;
DROP TABLE team_permissions;
ALTER TABLE team_permissions_inventory RENAME TO team_permissions;

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_suppliers_name ON suppliers(name COLLATE NOCASE);

CREATE TABLE supplier_offerings (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  UNIQUE (supplier_id, position)
);
CREATE INDEX idx_supplier_offerings_supplier ON supplier_offerings(supplier_id);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  ownership TEXT NOT NULL CHECK (ownership IN ('own', 'rental')),
  unit TEXT NOT NULL DEFAULT 'unidade',
  dimensions TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_inventory_items_name ON inventory_items(name COLLATE NOCASE);
CREATE INDEX idx_inventory_items_supplier ON inventory_items(supplier_id);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  event_id TEXT REFERENCES events(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_inventory_movements_item ON inventory_movements(item_id, created_at);

CREATE TABLE inventory_reservations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK
    (status IN ('reserved', 'released', 'completed')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (starts_at < ends_at)
);
CREATE INDEX idx_inventory_reservations_period ON inventory_reservations
  (item_id, status, starts_at, ends_at);
CREATE INDEX idx_inventory_reservations_event ON inventory_reservations(event_id, status);

CREATE TABLE inventory_item_photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  storage_name TEXT NOT NULL UNIQUE,
  archived_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_inventory_item_photos_item ON inventory_item_photos(item_id, created_at);
