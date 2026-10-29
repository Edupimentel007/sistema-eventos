ALTER TABLE financial_payments ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX idx_financial_payments_request_key
  ON financial_payments(account_id, request_key) WHERE request_key IS NOT NULL;
