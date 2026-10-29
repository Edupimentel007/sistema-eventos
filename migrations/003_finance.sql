-- Valores monetários são sempre centavos inteiros. Registros financeiros não são apagados:
-- pagamentos incorretos são estornados logicamente para manter a trilha de auditoria.
CREATE TABLE team_permissions_finance (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('dashboard', 'clients', 'events', 'calendar', 'finance')),
  can_view INTEGER NOT NULL DEFAULT 0 CHECK (can_view IN (0, 1)),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  PRIMARY KEY (user_id, module)
);
INSERT INTO team_permissions_finance (user_id, module, can_view, can_edit)
  SELECT user_id, module, can_view, can_edit FROM team_permissions;
DROP TABLE team_permissions;
ALTER TABLE team_permissions_finance RENAME TO team_permissions;

CREATE TABLE financial_accounts (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
  title TEXT NOT NULL,
  event_id TEXT REFERENCES events(id) ON DELETE RESTRICT,
  client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT,
  category TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  shared_with_client INTEGER NOT NULL DEFAULT 0 CHECK (shared_with_client IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (shared_with_client = 0 OR (direction = 'receivable' AND event_id IS NOT NULL))
);
CREATE INDEX idx_financial_accounts_event ON financial_accounts(event_id, direction);
CREATE INDEX idx_financial_accounts_client ON financial_accounts(client_id);

CREATE TABLE financial_installments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, sequence)
);
CREATE INDEX idx_financial_installments_due ON financial_installments(due_date);

CREATE TABLE financial_payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  paid_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_financial_payments_account ON financial_payments(account_id, voided_at);
CREATE INDEX idx_financial_payments_date ON financial_payments(paid_on);

CREATE TABLE financial_payment_allocations (
  payment_id TEXT NOT NULL REFERENCES financial_payments(id) ON DELETE RESTRICT,
  installment_id TEXT NOT NULL REFERENCES financial_installments(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (payment_id, installment_id)
);
