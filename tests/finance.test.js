import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/security.js';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'eventos-finance-'));
  const path = join(dir, 'db.sqlite');
  let app = createApp({ dbPath: path });
  app.db.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at)
    VALUES (?, 'Dona', 'dona@example.com', ?, 'owner', ?)`)
    .run(randomUUID(), hashPassword('senha-segura-123'), new Date().toISOString());
  const listen = async () => {
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  let base = await listen();
  const request = async (method, route, body, cookie) => {
    const response = await fetch(base + route, { method, headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const restart = async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
    app = createApp({ dbPath: path });
    base = await listen();
  };
  const cleanup = async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { request, restart, cleanup, base: () => base };
}

function eventPayload(clientIds, name = 'Casamento Ana') {
  return { name, type: 'casamento', status: 'contratado',
    startAt: '2027-06-19T19:00:00.000Z', timezone: 'America/Sao_Paulo', clientIds };
}

test('migração financeira atualiza banco da etapa anterior sem apagar usuários e permissões', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eventos-finance-upgrade-'));
  const path = join(dir, 'old.sqlite');
  try {
    const old = new DatabaseSync(path);
    old.exec('PRAGMA foreign_keys = ON');
    old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const name of ['001_base.sql', '002_client_creator.sql']) {
      old.exec(readFileSync(resolve(import.meta.dirname, '..', 'migrations', name), 'utf8'));
      old.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(name, new Date().toISOString());
    }
    const userId = randomUUID();
    old.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at)
      VALUES (?, 'Equipe antiga', 'equipe-antiga@example.com', '', 'team', ?)`)
      .run(userId, new Date().toISOString());
    old.prepare(`INSERT INTO team_permissions (user_id, module, can_view, can_edit)
      VALUES (?, 'events', 1, 0)`).run(userId);
    old.close();
    const upgraded = openDatabase(path);
    assert.equal(upgraded.prepare(`SELECT can_view FROM team_permissions
      WHERE user_id = ? AND module = 'events'`).get(userId).can_view, 1);
    upgraded.prepare(`INSERT INTO team_permissions (user_id, module, can_view, can_edit)
      VALUES (?, 'finance', 1, 0)`).run(userId);
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get().total, 4);
    upgraded.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('parcelas, pagamentos parciais e estornos preservam saldos em centavos', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const client = (await f.request('POST', '/api/clients',
      { name: 'Ana', email: 'ana-finance@example.com' }, owner)).data.client;
    const event = (await f.request('POST', '/api/events', eventPayload([client.id]), owner)).data.event;
    const receivable = await f.request('POST', '/api/finance/accounts', {
      direction: 'receivable', title: 'Contrato', eventId: event.id, clientId: client.id,
      amountCents: 100_000, sharedWithClient: true,
      installments: [{ amountCents: 40_000, dueDate: '2027-05-10' },
        { amountCents: 60_000, dueDate: '2027-06-10' }],
    }, owner);
    assert.equal(receivable.status, 201);
    assert.equal(receivable.data.account.installments.length, 2);
    const expense = await f.request('POST', '/api/finance/accounts', {
      direction: 'payable', title: 'Flores', eventId: event.id,
      amountCents: 35_000, dueDate: '2027-06-12',
    }, owner);
    assert.equal(expense.status, 201);
    assert.equal((await f.request('POST', '/api/finance/accounts', {
      direction: 'receivable', title: 'Inconsistente', amountCents: 1000,
      installments: [{ amountCents: 999, dueDate: '2027-06-10' }],
    }, owner)).status, 422);
    const paid = await f.request('POST', `/api/finance/accounts/${receivable.data.account.id}/payments`, {
      amountCents: 45_000, paidOn: '2027-05-11', paymentMethod: 'pix', requestId: 'request-123',
    }, owner);
    assert.equal(paid.status, 201);
    assert.deepEqual(paid.data.account.installments.map((item) => item.paidCents), [40_000, 5_000]);
    assert.equal(paid.data.account.balanceCents, 55_000);
    const retried = await f.request('POST', `/api/finance/accounts/${receivable.data.account.id}/payments`, {
      amountCents: 45_000, paidOn: '2027-05-11', paymentMethod: 'pix', requestId: 'request-123',
    }, owner);
    assert.equal(retried.status, 200);
    assert.equal(retried.data.paymentId, paid.data.paymentId);
    assert.equal(retried.data.account.paidCents, 45_000);
    assert.equal((await f.request('POST', `/api/finance/accounts/${receivable.data.account.id}/payments`, {
      amountCents: 100, paidOn: '2027-05-11', paymentMethod: 'pix', requestId: 'request-123',
    }, owner)).status, 409);
    assert.equal((await f.request('POST', `/api/finance/accounts/${receivable.data.account.id}/payments`, {
      amountCents: 55_001, paidOn: '2027-05-11', paymentMethod: 'pix',
    }, owner)).status, 422);
    const report = await f.request('GET', `/api/finance/events/${event.id}/summary`, undefined, owner);
    assert.equal(report.data.summary.contractedCents, 100_000);
    assert.equal(report.data.summary.receivedCents, 45_000);
    assert.equal(report.data.summary.receivableCents, 55_000);
    assert.equal(report.data.summary.plannedCostCents, 35_000);
    assert.equal(report.data.summary.estimatedResultCents, 65_000);
    const dueInMay = await f.request('GET',
      '/api/finance/summary?from=2027-05-01&to=2027-05-31', undefined, owner);
    assert.equal(dueInMay.status, 200);
    assert.equal(dueInMay.data.summary.contractedCents, 40_000);
    assert.equal(dueInMay.data.summary.receivedCents, 40_000);
    assert.equal(dueInMay.data.summary.plannedCostCents, 0);
    assert.equal(dueInMay.data.cashFlow.receivedCents, 45_000);
    assert.equal(dueInMay.data.period.basis, 'installment_due_date');
    assert.equal((await f.request('GET', '/api/finance/summary?from=2027-05-31&to=2027-05-01',
      undefined, owner)).status, 422);
    await f.restart();
    assert.equal((await f.request('GET', `/api/finance/accounts/${receivable.data.account.id}`,
      undefined, owner)).data.account.paidCents, 45_000);
    const voided = await f.request('POST', `/api/finance/payments/${paid.data.paymentId}/void`,
      { reason: 'Duplicado' }, owner);
    assert.equal(voided.status, 200);
    assert.equal(voided.data.account.balanceCents, 100_000);
    assert.equal((await f.request('POST', `/api/finance/payments/${paid.data.paymentId}/void`,
      { reason: 'Outro motivo' }, owner)).status, 409);
    const added = await f.request('POST', `/api/finance/accounts/${receivable.data.account.id}/installments`,
      { amountCents: 10_000, dueDate: '2027-07-10' }, owner);
    assert.equal(added.status, 201);
    assert.equal(added.data.account.amountCents, 110_000);
    const changed = await f.request('PATCH',
      `/api/finance/accounts/${receivable.data.account.id}/installments/${added.data.account.installments[2].id}`,
      { amountCents: 15_000, dueDate: '2027-08-10' }, owner);
    assert.equal(changed.status, 200);
    assert.equal(changed.data.account.amountCents, 115_000);
    assert.equal(changed.data.account.installments[2].dueDate, '2027-08-10');
  } finally { await f.cleanup(); }
});

test('portal mostra só contas compartilhadas do próprio evento, sem custos ou notas internas', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const ana = (await f.request('POST', '/api/clients',
      { name: 'Ana', email: 'ana-portal-fin@example.com' }, owner)).data.client;
    const bia = (await f.request('POST', '/api/clients',
      { name: 'Bia', email: 'bia-portal-fin@example.com' }, owner)).data.client;
    const eventA = (await f.request('POST', '/api/events', eventPayload([ana.id]), owner)).data.event;
    const eventB = (await f.request('POST', '/api/events', eventPayload([bia.id], 'Evento B'), owner)).data.event;
    const visible = (await f.request('POST', '/api/finance/accounts', {
      direction: 'receivable', title: 'Pacote contratado', eventId: eventA.id,
      clientId: ana.id, amountCents: 80_000, dueDate: '2027-06-10', sharedWithClient: true,
      notes: 'Margem 40%', supplierName: 'Fornecedor interno',
    }, owner)).data.account;
    await f.request('POST', '/api/finance/accounts', {
      direction: 'receivable', title: 'Proposta interna', eventId: eventA.id,
      amountCents: 20_000, dueDate: '2027-06-10',
    }, owner);
    await f.request('POST', '/api/finance/accounts', {
      direction: 'payable', title: 'Custo das flores', eventId: eventA.id,
      amountCents: 30_000, dueDate: '2027-06-10',
    }, owner);
    await f.request('POST', '/api/finance/accounts', {
      direction: 'receivable', title: 'Contrato B', eventId: eventB.id,
      amountCents: 50_000, dueDate: '2027-06-10', sharedWithClient: true,
    }, owner);
    await f.request('POST', `/api/finance/accounts/${visible.id}/payments`, {
      amountCents: 30_000, paidOn: '2027-05-01', paymentMethod: 'pix',
      notes: 'Compensação interna', reference: 'ABC',
    }, owner);
    const invitation = await f.request('POST', `/api/events/${eventA.id}/invitations`,
      { clientId: ana.id }, owner);
    const token = new URL(invitation.data.inviteUrl).searchParams.get('token');
    const client = (await f.request('POST', '/api/invitations/accept',
      { token, password: 'senha-cliente-fin-123' })).cookie;
    const portal = await f.request('GET', `/api/portal/events/${eventA.id}/finance`, undefined, client);
    assert.equal(portal.status, 200);
    assert.equal(portal.data.summary.contractedCents, 80_000);
    assert.equal(portal.data.summary.receivedCents, 30_000);
    assert.equal(portal.data.accounts.length, 1);
    const serialized = JSON.stringify(portal.data);
    for (const secret of ['Margem', 'Fornecedor interno', 'Compensação interna',
      'Proposta interna', 'Custo das flores', 'Contrato B']) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.equal((await f.request('GET', `/api/portal/events/${eventB.id}/finance`, undefined, client)).status, 404);
    assert.equal((await f.request('GET', '/api/finance/accounts', undefined, client)).status, 403);
    const csv = await fetch(f.base() + '/api/finance/export.csv', { headers: { Cookie: owner } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const contents = await csv.text();
    assert.match(contents, /Valor \(R\$\)/);
    assert.match(contents, /800,00/);
  } finally { await f.cleanup(); }
});

test('permissões e escopo de evento são impostos no financeiro da equipe', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const invitation = await f.request('POST', '/api/team', {
      name: 'Financeira', email: 'financeira@example.com',
      permissions: { finance: { read: true, write: false } },
    }, owner);
    const teamId = invitation.data.user.id;
    const token = new URL(invitation.data.inviteUrl).searchParams.get('token');
    const team = (await f.request('POST', '/api/team/invitations/accept',
      { token, password: 'senha-equipe-fin-123' })).cookie;
    const clientA = (await f.request('POST', '/api/clients',
      { name: 'Ana', email: 'ana-equipe-fin@example.com' }, owner)).data.client;
    const eventA = (await f.request('POST', '/api/events', {
      ...eventPayload([clientA.id]), teamUserIds: [teamId],
    }, owner)).data.event;
    const eventB = (await f.request('POST', '/api/events', eventPayload([], 'Privado'), owner)).data.event;
    const accountA = (await f.request('POST', '/api/finance/accounts', {
      direction: 'receivable', title: 'A', eventId: eventA.id,
      amountCents: 1000, dueDate: '2027-06-10',
    }, owner)).data.account;
    const accountB = (await f.request('POST', '/api/finance/accounts', {
      direction: 'payable', title: 'B', eventId: eventB.id,
      amountCents: 500, dueDate: '2027-06-10',
    }, owner)).data.account;
    assert.deepEqual((await f.request('GET', '/api/finance/events', undefined, team))
      .data.events.map((e) => e.id), [eventA.id]);
    assert.deepEqual((await f.request('GET', `/api/finance/events/${eventA.id}/clients`, undefined, team))
      .data.clients.map((c) => c.id), [clientA.id]);
    assert.equal((await f.request('GET', `/api/finance/events/${eventB.id}/clients`, undefined, team)).status, 404);
    assert.deepEqual((await f.request('GET', '/api/finance/accounts', undefined, team))
      .data.accounts.map((a) => a.id), [accountA.id]);
    assert.equal((await f.request('GET', `/api/finance/accounts/${accountB.id}`, undefined, team)).status, 404);
    assert.equal((await f.request('POST', `/api/finance/accounts/${accountA.id}/payments`, {
      amountCents: 100, paidOn: '2027-06-10', paymentMethod: 'pix',
    }, team)).status, 403);
    await f.request('PATCH', `/api/team/${teamId}/permissions`, {
      permissions: { finance: { read: true, write: true } },
    }, owner);
    assert.equal((await f.request('POST', `/api/finance/accounts/${accountA.id}/payments`, {
      amountCents: 100, paidOn: '2027-06-10', paymentMethod: 'pix',
    }, team)).status, 201);
    assert.equal((await f.request('POST', '/api/finance/accounts', {
      direction: 'receivable', title: 'Sem evento', amountCents: 100,
      dueDate: '2027-06-10',
    }, team)).status, 403);
    assert.equal((await f.request('GET', `/api/finance/events/${eventB.id}/summary`, undefined, team)).status, 404);
  } finally { await f.cleanup(); }
});
