import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';

const MAX_CENTS = 1_000_000_000_000;
const MAX_INSTALLMENTS = 120;

function localToday() {
  const configured = process.env.DEFAULT_TIMEZONE || 'America/Sao_Paulo';
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-US', { timeZone: configured,
    year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit' }); }
  const parts = formatter.formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function field(value, label, max, required, fail) {
  if (value === undefined || value === null) {
    if (required) fail(422, `${label} é obrigatório.`);
    return '';
  }
  if (typeof value !== 'string') fail(422, `${label} deve ser texto.`);
  const cleaned = value.trim();
  if (required && !cleaned) fail(422, `${label} é obrigatório.`);
  if (cleaned.length > max) fail(422, `${label} excede ${max} caracteres.`);
  return cleaned;
}

function cents(value, label, fail) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_CENTS) {
    fail(422, `${label} deve ser um valor positivo em centavos inteiros.`);
  }
  return value;
}

function localDate(value, label, fail) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(422, `${label} deve estar no formato AAAA-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    fail(422, `${label} inválida.`);
  }
  return value;
}

function optionalId(value, label, fail) {
  if (value === undefined || value === null || value === '') return null;
  return field(value, label, 100, true, fail);
}

function readInstallments(db, accountId, today) {
  const rows = db.prepare(`SELECT i.id, i.sequence, i.due_date, i.amount_cents,
    COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN pa.amount_cents ELSE 0 END), 0) AS paid_cents
    FROM financial_installments i
    LEFT JOIN financial_payment_allocations pa ON pa.installment_id = i.id
    LEFT JOIN financial_payments p ON p.id = pa.payment_id
    WHERE i.account_id = ? GROUP BY i.id ORDER BY i.due_date, i.sequence`).all(accountId);
  return rows.map((row) => {
    const balance = row.amount_cents - row.paid_cents;
    return {
      id: row.id, sequence: row.sequence, dueDate: row.due_date,
      amountCents: row.amount_cents, paidCents: row.paid_cents, balanceCents: balance,
      status: balance === 0 ? 'paid' : row.due_date < today ? 'overdue' : row.paid_cents > 0 ? 'partial' : 'open',
    };
  });
}

function readPayments(db, accountId, portal) {
  const rows = db.prepare(`SELECT * FROM financial_payments WHERE account_id = ?
    ORDER BY paid_on DESC, created_at DESC`).all(accountId);
  return rows.filter((row) => !portal || !row.voided_at).map((row) => ({
    id: row.id, paidOn: row.paid_on, amountCents: row.amount_cents,
    paymentMethod: row.payment_method,
    ...(portal ? {} : { reference: row.reference, notes: row.notes,
      voidedAt: row.voided_at, voidReason: row.void_reason }),
  }));
}

function accountDto(db, row, portal = false, today = new Date().toISOString().slice(0, 10)) {
  const installments = readInstallments(db, row.id, today);
  const paid = installments.reduce((sum, item) => sum + item.paidCents, 0);
  const balance = row.amount_cents - paid;
  const overdue = installments.reduce((sum, item) => sum + (item.status === 'overdue' ? item.balanceCents : 0), 0);
  const base = {
    id: row.id, title: row.title, eventId: row.event_id, eventName: row.event_name || null,
    clientId: row.client_id, amountCents: row.amount_cents, paidCents: paid,
    balanceCents: balance, overdueCents: overdue,
    status: balance === 0 ? 'paid' : overdue > 0 ? 'overdue' : paid > 0 ? 'partial' : 'open',
    installments, payments: readPayments(db, row.id, portal),
  };
  if (portal) return base;
  return {
    ...base, direction: row.direction, category: row.category, supplierName: row.supplier_name,
    sharedWithClient: Boolean(row.shared_with_client), notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function summary(accounts) {
  const result = {
    contractedCents: 0, receivedCents: 0, receivableCents: 0,
    plannedCostCents: 0, paidCostCents: 0, payableCents: 0,
    overdueReceivableCents: 0, overduePayableCents: 0,
    estimatedResultCents: 0, realizedResultCents: 0,
  };
  for (const account of accounts) {
    if (account.direction === 'receivable') {
      result.contractedCents += account.amountCents;
      result.receivedCents += account.paidCents;
      result.receivableCents += account.balanceCents;
      result.overdueReceivableCents += account.overdueCents;
    } else {
      result.plannedCostCents += account.amountCents;
      result.paidCostCents += account.paidCents;
      result.payableCents += account.balanceCents;
      result.overduePayableCents += account.overdueCents;
    }
  }
  result.estimatedResultCents = result.contractedCents - result.plannedCostCents;
  result.realizedResultCents = result.receivedCents - result.paidCostCents;
  return result;
}

function duePeriodAccounts(accounts, from, to) {
  if (!from && !to) return accounts;
  return accounts.map((account) => {
    const installments = account.installments.filter((item) =>
      (!from || item.dueDate >= from) && (!to || item.dueDate <= to));
    const total = installments.reduce((sum, item) => sum + item.amountCents, 0);
    const paid = installments.reduce((sum, item) => sum + item.paidCents, 0);
    return { ...account, installments, amountCents: total, paidCents: paid,
      balanceCents: total - paid,
      overdueCents: installments.reduce((sum, item) =>
        sum + (item.status === 'overdue' ? item.balanceCents : 0), 0) };
  }).filter((account) => account.installments.length > 0);
}

function cashFlow(accounts, from, to) {
  let receivedCents = 0;
  let paidCents = 0;
  for (const account of accounts) {
    for (const payment of account.payments) {
      if (payment.voidedAt || (from && payment.paidOn < from) || (to && payment.paidOn > to)) continue;
      if (account.direction === 'receivable') receivedCents += payment.amountCents;
      else paidCents += payment.amountCents;
    }
  }
  return { receivedCents, paidCents, netCents: receivedCents - paidCents };
}

function scopedAccounts(db, user, filters = {}) {
  const clauses = [];
  const args = [];
  if (user.role === 'team') {
    clauses.push('EXISTS (SELECT 1 FROM event_team et WHERE et.event_id = a.event_id AND et.user_id = ?)');
    args.push(user.id);
  }
  if (filters.eventId) { clauses.push('a.event_id = ?'); args.push(filters.eventId); }
  if (filters.direction) { clauses.push('a.direction = ?'); args.push(filters.direction); }
  if (filters.q) {
    clauses.push('(a.title LIKE ? OR a.category LIKE ? OR a.supplier_name LIKE ? OR e.name LIKE ?)');
    args.push(...Array(4).fill(`%${filters.q}%`));
  }
  return db.prepare(`SELECT a.*, e.name AS event_name FROM financial_accounts a
    LEFT JOIN events e ON e.id = a.event_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY a.created_at DESC, a.id DESC`).all(...args);
}

function getAccount(db, user, id, fail) {
  const row = db.prepare(`SELECT a.*, e.name AS event_name FROM financial_accounts a
    LEFT JOIN events e ON e.id = a.event_id WHERE a.id = ?`).get(id);
  if (!row || (user.role === 'team' && !db.prepare(`SELECT 1 FROM event_team
    WHERE event_id = ? AND user_id = ?`).get(row.event_id, user.id))) {
    fail(404, 'Conta financeira não encontrada.');
  }
  return row;
}

function requireFinanceEvent(db, user, eventId, fail) {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!event || (user.role === 'team' && !db.prepare(
    'SELECT 1 FROM event_team WHERE event_id = ? AND user_id = ?').get(eventId, user.id))) {
    fail(404, 'Evento não encontrado.');
  }
}

function ensureClientRelation(db, eventId, clientId, fail) {
  if (clientId && (!eventId || !db.prepare(
    'SELECT 1 FROM event_clients WHERE event_id = ? AND client_id = ?').get(eventId, clientId))) {
    fail(422, 'O cliente deve estar vinculado ao evento.');
  }
}

function exportCsv(accounts) {
  const reais = (amountCents) => {
    const integer = Math.trunc(amountCents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${integer},${String(amountCents % 100).padStart(2, '0')}`;
  };
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [
    ['Título', 'Tipo', 'Evento', 'Categoria', 'Valor (R$)', 'Pago (R$)',
      'Saldo (R$)', 'Vencido (R$)', 'Situação'],
    ...accounts.map((a) => [a.title, a.direction === 'receivable' ? 'A receber' : 'A pagar',
      a.eventName, a.category, reais(a.amountCents), reais(a.paidCents),
      reais(a.balanceCents), reais(a.overdueCents),
      { open: 'Em aberto', partial: 'Parcial', overdue: 'Vencido', paid: 'Quitado' }[a.status] || a.status]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}

export async function handleFinanceApi({ db, req, res, url, user, json, bodyJson, fail,
  requirePermission, requireCurrentUser, linkedClient, audit }) {
  const method = req.method || 'GET';
  const path = url.pathname;
  const today = localToday();

  if (path.startsWith('/api/portal/events/') && path.endsWith('/finance')) {
    if (method !== 'GET') fail(405, 'Método não permitido.');
    const eventId = path.match(/^\/api\/portal\/events\/([^/]+)\/finance$/)?.[1];
    if (!eventId || !linkedClient(db, user, eventId)) fail(404, 'Evento não encontrado.');
    const rows = db.prepare(`SELECT a.*, e.name AS event_name FROM financial_accounts a
      JOIN events e ON e.id = a.event_id WHERE a.event_id = ? AND a.direction = 'receivable'
      AND a.shared_with_client = 1 AND (a.client_id IS NULL OR a.client_id = ?)
      ORDER BY a.created_at DESC`).all(eventId, user.client_id);
    const accounts = rows.map((row) => accountDto(db, row, true, today));
    const contractedCents = accounts.reduce((sum, item) => sum + item.amountCents, 0);
    const receivedCents = accounts.reduce((sum, item) => sum + item.paidCents, 0);
    return json(res, 200, { summary: { contractedCents, receivedCents,
      receivableCents: contractedCents - receivedCents }, accounts });
  }

  if (!path.startsWith('/api/finance')) return false;
  requirePermission(db, user, 'finance');

  if (method === 'GET' && path === '/api/finance/events') {
    const rows = user.role === 'owner'
      ? db.prepare('SELECT id, code, name, start_at FROM events ORDER BY start_at DESC').all()
      : db.prepare(`SELECT e.id, e.code, e.name, e.start_at FROM events e
        JOIN event_team et ON et.event_id = e.id WHERE et.user_id = ?
        ORDER BY e.start_at DESC`).all(user.id);
    return json(res, 200, { events: rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, startAt: row.start_at,
    })) });
  }

  const eventClientsMatch = path.match(/^\/api\/finance\/events\/([^/]+)\/clients$/);
  if (eventClientsMatch && method === 'GET') {
    requireFinanceEvent(db, user, eventClientsMatch[1], fail);
    const clients = db.prepare(`SELECT c.id, c.name, c.email FROM clients c
      JOIN event_clients ec ON ec.client_id = c.id WHERE ec.event_id = ? ORDER BY c.name`)
      .all(eventClientsMatch[1]);
    return json(res, 200, { clients });
  }

  if (method === 'GET' && (path === '/api/finance/summary' || path === '/api/finance/accounts' ||
      path === '/api/finance/export.csv')) {
    const direction = url.searchParams.get('direction');
    if (direction && !['receivable', 'payable'].includes(direction)) fail(422, 'Tipo de conta inválido.');
    const eventId = url.searchParams.get('eventId');
    if (eventId) requireFinanceEvent(db, user, eventId, fail);
    const q = field(url.searchParams.get('q'), 'Busca', 100, false, fail);
    const status = url.searchParams.get('status');
    if (status && !['open', 'partial', 'overdue', 'paid'].includes(status)) fail(422, 'Situação inválida.');
    const from = url.searchParams.has('from') ? localDate(url.searchParams.get('from'), 'Data inicial', fail) : null;
    const to = url.searchParams.has('to') ? localDate(url.searchParams.get('to'), 'Data final', fail) : null;
    if (from && to && from > to) fail(422, 'Data final deve ser igual ou posterior à inicial.');
    const all = scopedAccounts(db, user, { direction, eventId, q })
      .map((row) => accountDto(db, row, false, today));
    const accounts = status ? all.filter((account) => account.status === status) : all;
    const inPeriod = (!from && !to) ? accounts : accounts.filter((account) =>
      account.installments.some((item) => (!from || item.dueDate >= from) && (!to || item.dueDate <= to)));
    if (path === '/api/finance/accounts') return json(res, 200, { accounts: inPeriod });
    if (path === '/api/finance/export.csv') {
      const content = exportCsv(inPeriod);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="financeiro.csv"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(content);
      return true;
    }
    const periodAccounts = duePeriodAccounts(inPeriod, from, to);
    const upcoming = periodAccounts.flatMap((account) => account.installments
      .filter((installment) => installment.balanceCents > 0)
      .map((installment) => ({ accountId: account.id, accountTitle: account.title,
        eventId: account.eventId, eventName: account.eventName, direction: account.direction,
        ...installment })))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 12);
    return json(res, 200, { summary: summary(periodAccounts), upcoming,
      cashFlow: cashFlow(accounts, from, to),
      period: { from, to, basis: 'installment_due_date' } });
  }

  const eventSummaryMatch = path.match(/^\/api\/finance\/events\/([^/]+)\/summary$/);
  if (eventSummaryMatch && method === 'GET') {
    requireFinanceEvent(db, user, eventSummaryMatch[1], fail);
    const accounts = scopedAccounts(db, user, { eventId: eventSummaryMatch[1] })
      .map((row) => accountDto(db, row, false, today));
    return json(res, 200, { summary: summary(accounts), accounts });
  }

  if (path === '/api/finance/accounts' && method === 'POST') {
    requirePermission(db, user, 'finance', 'edit');
    const body = await bodyJson(req);
    const direction = field(body.direction, 'Tipo de conta', 20, true, fail);
    if (!['receivable', 'payable'].includes(direction)) fail(422, 'Tipo de conta inválido.');
    const title = field(body.title, 'Título', 200, true, fail);
    const eventId = optionalId(body.eventId, 'Evento', fail);
    const clientId = optionalId(body.clientId, 'Cliente', fail);
    const category = field(body.category, 'Categoria', 100, false, fail);
    const supplierName = field(body.supplierName, 'Fornecedor', 150, false, fail);
    const notes = field(body.notes, 'Observações', 5000, false, fail);
    if (body.sharedWithClient !== undefined && typeof body.sharedWithClient !== 'boolean') {
      fail(422, 'Visibilidade do cliente inválida.');
    }
    const shared = body.sharedWithClient === true;
    if (shared && (direction !== 'receivable' || !eventId)) {
      fail(422, 'Somente contas a receber vinculadas a evento podem ser compartilhadas.');
    }
    if (clientId && direction !== 'receivable') fail(422, 'Cliente só pode ser indicado em conta a receber.');
    let installments;
    if (body.installments !== undefined) {
      if (!Array.isArray(body.installments) || body.installments.length < 1 ||
          body.installments.length > MAX_INSTALLMENTS) fail(422, 'Parcelas inválidas.');
      installments = body.installments.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) fail(422, 'Parcela inválida.');
        return { amountCents: cents(item.amountCents, 'Valor da parcela', fail),
          dueDate: localDate(item.dueDate, 'Vencimento', fail) };
      });
    } else {
      installments = [{ amountCents: cents(body.amountCents, 'Valor', fail),
        dueDate: localDate(body.dueDate, 'Vencimento', fail) }];
    }
    const amount = installments.reduce((sum, item) => sum + item.amountCents, 0);
    if (!Number.isSafeInteger(amount) || amount > MAX_CENTS) fail(422, 'Valor total excede o limite.');
    if (body.amountCents !== undefined && cents(body.amountCents, 'Valor total', fail) !== amount) {
      fail(422, 'A soma das parcelas deve corresponder ao valor total.');
    }
    const id = randomUUID();
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'finance', 'edit');
      if (current.role === 'team' && !eventId) fail(403, 'A equipe só pode lançar contas de seus eventos.');
      if (eventId) requireFinanceEvent(db, current, eventId, fail);
      ensureClientRelation(db, eventId, clientId, fail);
      const timestamp = new Date().toISOString();
      db.prepare(`INSERT INTO financial_accounts
        (id, direction, title, event_id, client_id, category, supplier_name, amount_cents,
          shared_with_client, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, direction, title, eventId,
        clientId, category, supplierName, amount, Number(shared), notes, current.id, timestamp, timestamp);
      const insert = db.prepare(`INSERT INTO financial_installments
        (id, account_id, sequence, due_date, amount_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      installments.forEach((item, index) => insert.run(randomUUID(), id, index + 1,
        item.dueDate, item.amountCents, timestamp, timestamp));
      audit(db, current.id, 'financial_account', id, 'created', { eventId, direction, amountCents: amount });
    });
    return json(res, 201, { account: accountDto(db, getAccount(db, user, id, fail), false, today) });
  }

  const accountMatch = path.match(/^\/api\/finance\/accounts\/([^/]+)$/);
  if (accountMatch && method === 'GET') {
    return json(res, 200, { account: accountDto(db, getAccount(db, user, accountMatch[1], fail), false, today) });
  }
  if (accountMatch && method === 'PATCH') {
    requirePermission(db, user, 'finance', 'edit');
    const body = await bodyJson(req);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'finance', 'edit');
      const old = getAccount(db, current, accountMatch[1], fail);
      const title = Object.hasOwn(body, 'title') ? field(body.title, 'Título', 200, true, fail) : old.title;
      const category = Object.hasOwn(body, 'category') ? field(body.category, 'Categoria', 100, false, fail) : old.category;
      const supplier = Object.hasOwn(body, 'supplierName') ? field(body.supplierName, 'Fornecedor', 150, false, fail) : old.supplier_name;
      const notes = Object.hasOwn(body, 'notes') ? field(body.notes, 'Observações', 5000, false, fail) : old.notes;
      const clientId = Object.hasOwn(body, 'clientId') ? optionalId(body.clientId, 'Cliente', fail) : old.client_id;
      if (clientId && old.direction !== 'receivable') fail(422, 'Cliente só pode ser indicado em conta a receber.');
      ensureClientRelation(db, old.event_id, clientId, fail);
      let shared = old.shared_with_client;
      if (Object.hasOwn(body, 'sharedWithClient')) {
        if (typeof body.sharedWithClient !== 'boolean') fail(422, 'Visibilidade do cliente inválida.');
        shared = Number(body.sharedWithClient);
      }
      if (shared && (old.direction !== 'receivable' || !old.event_id)) fail(422, 'Conta não pode ser compartilhada.');
      let amount = old.amount_cents;
      if (Object.hasOwn(body, 'amountCents') || Object.hasOwn(body, 'dueDate')) {
        const parts = readInstallments(db, old.id, today);
        if (parts.length !== 1 || parts[0].paidCents > 0) {
          fail(409, 'Altere a parcela individualmente; valor pago não pode ser reduzido.');
        }
        amount = Object.hasOwn(body, 'amountCents') ? cents(body.amountCents, 'Valor', fail) : old.amount_cents;
        const due = Object.hasOwn(body, 'dueDate') ? localDate(body.dueDate, 'Vencimento', fail) : parts[0].dueDate;
        db.prepare(`UPDATE financial_installments SET amount_cents = ?, due_date = ?, updated_at = ? WHERE id = ?`)
          .run(amount, due, new Date().toISOString(), parts[0].id);
      }
      db.prepare(`UPDATE financial_accounts SET title = ?, client_id = ?, category = ?, supplier_name = ?,
        amount_cents = ?, shared_with_client = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .run(title, clientId, category, supplier, amount, shared, notes, new Date().toISOString(), old.id);
      audit(db, current.id, 'financial_account', old.id, 'updated', {
        fields: Object.keys(body), previousAmountCents: old.amount_cents });
    });
    return json(res, 200, { account: accountDto(db, getAccount(db, user, accountMatch[1], fail), false, today) });
  }

  const installmentsMatch = path.match(/^\/api\/finance\/accounts\/([^/]+)\/installments$/);
  if (installmentsMatch && method === 'POST') {
    requirePermission(db, user, 'finance', 'edit');
    const body = await bodyJson(req);
    const amount = cents(body.amountCents, 'Valor da parcela', fail);
    const dueDate = localDate(body.dueDate, 'Vencimento', fail);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'finance', 'edit');
      const account = getAccount(db, current, installmentsMatch[1], fail);
      const count = db.prepare(`SELECT COUNT(*) AS count, COALESCE(MAX(sequence), 0) AS last
        FROM financial_installments WHERE account_id = ?`).get(account.id);
      if (count.count >= MAX_INSTALLMENTS) fail(422, 'Limite de parcelas atingido.');
      const total = account.amount_cents + amount;
      if (!Number.isSafeInteger(total) || total > MAX_CENTS) fail(422, 'Valor total excede o limite.');
      const stamp = new Date().toISOString();
      const installmentId = randomUUID();
      db.prepare(`INSERT INTO financial_installments
        (id, account_id, sequence, due_date, amount_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(installmentId, account.id, count.last + 1, dueDate,
        amount, stamp, stamp);
      db.prepare('UPDATE financial_accounts SET amount_cents = ?, updated_at = ? WHERE id = ?')
        .run(total, stamp, account.id);
      audit(db, current.id, 'financial_installment', installmentId, 'created', {
        accountId: account.id, amountCents: amount, dueDate });
    });
    return json(res, 201, { account: accountDto(db,
      getAccount(db, user, installmentsMatch[1], fail), false, today) });
  }

  const installmentMatch = path.match(/^\/api\/finance\/accounts\/([^/]+)\/installments\/([^/]+)$/);
  if (installmentMatch && method === 'PATCH') {
    requirePermission(db, user, 'finance', 'edit');
    const body = await bodyJson(req);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'finance', 'edit');
      const account = getAccount(db, current, installmentMatch[1], fail);
      const old = db.prepare('SELECT * FROM financial_installments WHERE id = ? AND account_id = ?')
        .get(installmentMatch[2], account.id);
      if (!old) fail(404, 'Parcela não encontrada.');
      const paid = readInstallments(db, account.id, today).find((item) => item.id === old.id).paidCents;
      const amount = Object.hasOwn(body, 'amountCents')
        ? cents(body.amountCents, 'Valor da parcela', fail) : old.amount_cents;
      const dueDate = Object.hasOwn(body, 'dueDate')
        ? localDate(body.dueDate, 'Vencimento', fail) : old.due_date;
      if (amount < paid) fail(422, 'O novo valor da parcela não pode ser inferior ao já pago.');
      const total = account.amount_cents - old.amount_cents + amount;
      if (!Number.isSafeInteger(total) || total > MAX_CENTS) fail(422, 'Valor total excede o limite.');
      const stamp = new Date().toISOString();
      db.prepare(`UPDATE financial_installments SET due_date = ?, amount_cents = ?, updated_at = ?
        WHERE id = ?`).run(dueDate, amount, stamp, old.id);
      db.prepare('UPDATE financial_accounts SET amount_cents = ?, updated_at = ? WHERE id = ?')
        .run(total, stamp, account.id);
      audit(db, current.id, 'financial_installment', old.id, 'renegotiated', {
        accountId: account.id, previousAmountCents: old.amount_cents,
        previousDueDate: old.due_date, amountCents: amount, dueDate });
    });
    return json(res, 200, { account: accountDto(db,
      getAccount(db, user, installmentMatch[1], fail), false, today) });
  }

  const paymentMatch = path.match(/^\/api\/finance\/accounts\/([^/]+)\/payments$/);
  if (paymentMatch && method === 'POST') {
    requirePermission(db, user, 'finance', 'edit');
    const body = await bodyJson(req);
    const amount = cents(body.amountCents, 'Valor pago', fail);
    const paidOn = localDate(body.paidOn, 'Data do pagamento', fail);
    const paymentMethod = field(body.paymentMethod, 'Forma de pagamento', 60, true, fail);
    const reference = field(body.reference, 'Referência', 200, false, fail);
    const notes = field(body.notes, 'Observações', 5000, false, fail);
    const requestId = body.requestId === undefined ? null :
      field(body.requestId, 'Identificador da solicitação', 100, true, fail);
    const id = randomUUID();
    let resultId = id;
    let created = true;
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'finance', 'edit');
      const account = getAccount(db, current, paymentMatch[1], fail);
      if (requestId) {
        const prior = db.prepare(`SELECT * FROM financial_payments
          WHERE account_id = ? AND request_key = ?`).get(account.id, requestId);
        if (prior) {
          if (prior.voided_at || prior.amount_cents !== amount || prior.paid_on !== paidOn ||
              prior.payment_method !== paymentMethod || prior.reference !== reference || prior.notes !== notes) {
            fail(409, 'Identificador de pagamento já utilizado com outros dados.');
          }
          resultId = prior.id;
          created = false;
          return;
        }
      }
      const open = readInstallments(db, account.id, today).filter((item) => item.balanceCents > 0);
      const balance = open.reduce((sum, item) => sum + item.balanceCents, 0);
      if (amount > balance) fail(422, 'O pagamento excede o saldo da conta.');
      const timestamp = new Date().toISOString();
      db.prepare(`INSERT INTO financial_payments
        (id, account_id, paid_on, amount_cents, payment_method, reference, notes,
          request_key, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, account.id, paidOn, amount,
        paymentMethod, reference, notes, requestId, current.id, timestamp);
      let remaining = amount;
      const insert = db.prepare(`INSERT INTO financial_payment_allocations (payment_id, installment_id, amount_cents)
        VALUES (?, ?, ?)`);
      for (const item of open) {
        if (remaining === 0) break;
        const allocation = Math.min(remaining, item.balanceCents);
        insert.run(id, item.id, allocation);
        remaining -= allocation;
      }
      audit(db, current.id, 'financial_payment', id, 'recorded', {
        accountId: account.id, eventId: account.event_id, amountCents: amount });
    });
    return json(res, created ? 201 : 200, { paymentId: resultId,
      account: accountDto(db, getAccount(db, user, paymentMatch[1], fail), false, today) });
  }

  const voidMatch = path.match(/^\/api\/finance\/payments\/([^/]+)\/void$/);
  if (voidMatch && method === 'POST') {
    requirePermission(db, user, 'finance', 'edit');
    const body = await bodyJson(req);
    const reason = field(body.reason, 'Motivo', 500, true, fail);
    let accountId;
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'finance', 'edit');
      const payment = db.prepare('SELECT * FROM financial_payments WHERE id = ?').get(voidMatch[1]);
      if (!payment) fail(404, 'Pagamento não encontrado.');
      getAccount(db, current, payment.account_id, fail);
      if (payment.voided_at) fail(409, 'Pagamento já foi estornado.');
      accountId = payment.account_id;
      db.prepare('UPDATE financial_payments SET voided_at = ?, void_reason = ? WHERE id = ?')
        .run(new Date().toISOString(), reason, payment.id);
      audit(db, current.id, 'financial_payment', payment.id, 'voided', { accountId, reason });
    });
    return json(res, 200, { account: accountDto(db, getAccount(db, user, accountId, fail), false, today) });
  }

  fail(404, 'Rota financeira não encontrada.');
}
