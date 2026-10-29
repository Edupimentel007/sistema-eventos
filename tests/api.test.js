import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';
import { hashPassword, tokenHash } from '../server/security.js';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'eventos-api-'));
  const dbPath = join(dir, 'test.sqlite');
  let app = createApp({ dbPath });
  const ownerId = randomUUID();
  app.db.prepare(`INSERT INTO users
    (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)`)
    .run(ownerId, 'Proprietária', 'dona@example.com', hashPassword('senha-segura-123'), new Date().toISOString());
  const listen = async () => {
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  let base = await listen();
  const request = async (method, path, body, cookie) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const stop = async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
  };
  const restart = async () => {
    await stop();
    app = createApp({ dbPath });
    base = await listen();
  };
  const cleanup = async () => { await stop(); rmSync(dir, { recursive: true, force: true }); };
  return { request, restart, cleanup, database: () => app.db, baseUrl: () => base };
}

function slowJsonRequest(base, method, path, cookie, firstChunk) {
  const url = new URL(path, base);
  let req;
  const result = new Promise((resolve, reject) => {
    req = httpRequest(url, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks)) }));
    });
    req.on('error', reject);
    req.write(firstChunk);
  });
  return { result, finish: (rest) => req.end(rest) };
}

function eventPayload(clientIds, name = 'Casamento Ana e Lucas') {
  return {
    name, type: 'casamento', status: 'orcamento',
    startAt: '2027-06-19T19:00:00.000Z', endAt: '2027-06-20T04:00:00.000Z',
    timezone: 'America/Sao_Paulo', guestEstimated: 180,
    ceremonyName: 'Capela', receptionName: 'Salão',
    ceremonyAddress: 'Rua das Flores, 10', receptionAddress: 'Av. Jardim, 20',
    internalNotes: 'CUSTO SECRETO: R$ 12.345', clientIds,
  };
}

test('convites conectam clientes e isolamento persiste após reinício', async () => {
  const f = await fixture();
  try {
    const login = await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, 'owner');
    const owner = login.cookie;
    const ana = await f.request('POST', '/api/clients',
      { name: 'Ana', email: 'ana@example.com', phone: '11999999999' }, owner);
    const lucas = await f.request('POST', '/api/clients',
      { name: 'Lucas', email: 'lucas@example.com' }, owner);
    const bia = await f.request('POST', '/api/clients',
      { name: 'Bia', email: 'bia@example.com' }, owner);
    assert.equal(ana.status, 201);
    assert.equal(lucas.status, 201);
    assert.equal(bia.status, 201);
    const first = await f.request('POST', '/api/events',
      eventPayload([ana.data.client.id, lucas.data.client.id]), owner);
    const other = await f.request('POST', '/api/events',
      eventPayload([bia.data.client.id], 'Festa Bia'), owner);
    assert.equal(first.status, 201);
    assert.equal(other.status, 201);
    assert.equal(first.data.event.clients.length, 2);
    assert.equal(first.data.event.internalNotes, 'CUSTO SECRETO: R$ 12.345');
    const invitation = await f.request('POST', `/api/events/${first.data.event.id}/invitations`,
      { clientId: ana.data.client.id }, owner);
    assert.equal(invitation.status, 201);
    const token = new URL(invitation.data.inviteUrl).searchParams.get('token');
    const preview = await f.request('GET', `/api/invitations/preview?token=${token}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.invitation.eventName, 'Casamento Ana e Lucas');
    const accept = await f.request('POST', '/api/invitations/accept',
      { token, name: 'Ana', password: 'senha-cliente-123' });
    assert.equal(accept.status, 200);
    assert.equal(accept.data.user.role, 'client');
    const client = accept.cookie;
    assert.equal((await f.request('GET', `/api/invitations/preview?token=${token}`)).status, 404);
    const mine = await f.request('GET', '/api/portal/events', undefined, client);
    assert.equal(mine.status, 200);
    assert.equal(mine.data.events.length, 1);
    assert.equal(mine.data.events[0].id, first.data.event.id);
    assert.equal(JSON.stringify(mine.data).includes('CUSTO SECRETO'), false);
    assert.equal(JSON.stringify(mine.data).includes('lucas@example.com'), false);
    assert.equal((await f.request('GET', `/api/portal/events/${other.data.event.id}`, undefined, client)).status, 404);
    assert.equal((await f.request('GET', '/api/events', undefined, client)).status, 403);
    assert.equal((await f.request('GET', '/api/clients', undefined, client)).status, 403);
    assert.equal((await f.request('PATCH', `/api/events/${first.data.event.id}`, { internalNotes: 'alterado' }, client)).status, 403);
    await f.restart();
    const persisted = await f.request('GET', `/api/portal/events/${first.data.event.id}`, undefined, client);
    assert.equal(persisted.status, 200);
    assert.equal(persisted.data.event.name, 'Casamento Ana e Lucas');
    assert.equal(Object.hasOwn(persisted.data.event, 'internalNotes'), false);
    assert.equal((await f.request('PATCH', `/api/events/${first.data.event.id}`,
      { clientIds: [lucas.data.client.id] }, owner)).status, 200);
    assert.equal((await f.request('GET', `/api/portal/events/${first.data.event.id}`, undefined, client)).status, 404);
  } finally { await f.cleanup(); }
});

test('permissões de equipe e convite de ativação são aplicados no servidor', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const created = await f.request('POST', '/api/team', {
      name: 'Camila', email: 'camila@example.com', jobTitle: 'Produtora',
      permissions: { events: { read: true, write: false }, calendar: { read: true } },
    }, owner);
    assert.equal(created.status, 201);
    assert.equal(created.data.user.permissions.events.write, false);
    const token = new URL(created.data.inviteUrl).searchParams.get('token');
    const preview = await f.request('GET', `/api/team/invitations/preview?token=${token}`);
    assert.equal(preview.status, 200);
    const activation = await f.request('POST', '/api/team/invitations/accept',
      { token, password: 'senha-equipe-123' });
    assert.equal(activation.status, 200);
    const teamCookie = activation.cookie;
    assert.equal((await f.request('GET', '/api/events', undefined, teamCookie)).status, 200);
    assert.equal((await f.request('GET', '/api/clients', undefined, teamCookie)).status, 403);
    assert.equal((await f.request('POST', '/api/events', eventPayload([]), teamCookie)).status, 403);
    assert.equal((await f.request('GET', '/api/team', undefined, teamCookie)).status, 403);
    const update = await f.request('PATCH', `/api/team/${created.data.user.id}/permissions`, {
      permissions: { events: { read: true, write: true }, calendar: { read: true } },
    }, owner);
    assert.equal(update.status, 200);
    assert.equal(update.data.user.permissions.events.write, true);
    const createdEvent = await f.request('POST', '/api/events', eventPayload([]), teamCookie);
    assert.equal(createdEvent.status, 201);
    const dashboardOnly = await f.request('POST', '/api/team', {
      name: 'Rafa', email: 'rafa@example.com',
      permissions: { dashboard: { read: true }, calendar: { read: true } },
    }, owner);
    const dashboardToken = new URL(dashboardOnly.data.inviteUrl).searchParams.get('token');
    const dashboardCookie = (await f.request('POST', '/api/team/invitations/accept',
      { token: dashboardToken, password: 'senha-equipe-rafa-123' })).cookie;
    assert.equal((await f.request('PATCH', `/api/events/${createdEvent.data.event.id}`,
      { teamUserIds: [created.data.user.id, dashboardOnly.data.user.id] }, owner)).status, 200);
    const dashboard = await f.request('GET', '/api/dashboard', undefined, dashboardCookie);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.total, 1);
    assert.deepEqual(dashboard.data.upcoming, []);
    assert.deepEqual(dashboard.data.recent, []);
    const calendar = await f.request('GET', '/api/calendar?month=2027-06', undefined, dashboardCookie);
    assert.equal(calendar.data.events.length, 1);
    assert.equal(Object.hasOwn(calendar.data.events[0], 'internalNotes'), false);
    assert.equal((await f.request('GET', '/api/events', undefined, dashboardCookie)).status, 403);
  } finally { await f.cleanup(); }
});

test('equipe acessa somente eventos e clientes vinculados, inclusive no painel e calendário', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const clientA = (await f.request('POST', '/api/clients',
      { name: 'Cliente A', email: 'cliente-a@example.com' }, owner)).data.client;
    const clientB = (await f.request('POST', '/api/clients',
      { name: 'Cliente B', email: 'cliente-b@example.com' }, owner)).data.client;
    async function team(name, address) {
      const created = await f.request('POST', '/api/team', {
        name, email: address,
        permissions: {
          events: { read: true, write: true }, dashboard: { read: true },
          calendar: { read: true }, clients: { read: true, write: true },
        },
      }, owner);
      const token = new URL(created.data.inviteUrl).searchParams.get('token');
      const accepted = await f.request('POST', '/api/team/invitations/accept',
        { token, password: 'senha-equipe-acesso-123' });
      return { id: created.data.user.id, cookie: accepted.cookie };
    }
    const alba = await team('Alba', 'alba@example.com');
    const bruno = await team('Bruno', 'bruno@example.com');
    const eventA = (await f.request('POST', '/api/events', {
      ...eventPayload([clientA.id], 'Evento A'), teamUserIds: [alba.id],
    }, owner)).data.event;
    const eventB = (await f.request('POST', '/api/events', {
      ...eventPayload([clientB.id], 'Evento B'), teamUserIds: [bruno.id],
    }, owner)).data.event;
    const listA = await f.request('GET', '/api/events', undefined, alba.cookie);
    assert.deepEqual(listA.data.events.map((e) => e.id), [eventA.id]);
    assert.equal((await f.request('GET', `/api/events/${eventB.id}`, undefined, alba.cookie)).status, 404);
    assert.equal((await f.request('PATCH', `/api/events/${eventB.id}`,
      { name: 'Acesso indevido' }, alba.cookie)).status, 404);
    assert.equal((await f.request('PATCH', `/api/events/${eventA.id}`,
      { clientIds: [clientA.id, clientB.id] }, alba.cookie)).status, 403);
    const dashboardA = await f.request('GET', '/api/dashboard', undefined, alba.cookie);
    assert.equal(dashboardA.data.total, 1);
    assert.deepEqual(dashboardA.data.upcoming.map((e) => e.id), [eventA.id]);
    assert.deepEqual((await f.request('GET', '/api/calendar?month=2027-06', undefined, alba.cookie))
      .data.events.map((e) => e.id), [eventA.id]);
    assert.deepEqual((await f.request('GET', '/api/clients', undefined, alba.cookie))
      .data.clients.map((c) => c.id), [clientA.id]);
    assert.deepEqual((await f.request('GET', '/api/events', undefined, bruno.cookie))
      .data.events.map((e) => e.id), [eventB.id]);
    assert.equal((await f.request('POST', '/api/events',
      eventPayload([clientB.id], 'Tentativa fora do escopo'), alba.cookie)).status, 403);
    const createdByAlba = await f.request('POST', '/api/events', {
      ...eventPayload([clientA.id], 'Novo evento Alba'), teamUserIds: [bruno.id],
    }, alba.cookie);
    assert.equal(createdByAlba.status, 201);
    assert.deepEqual(createdByAlba.data.event.teamUserIds, [alba.id]);
    assert.equal((await f.request('PATCH', `/api/events/${createdByAlba.data.event.id}`,
      { teamUserIds: [] }, alba.cookie)).status, 422);
  } finally { await f.cleanup(); }
});

test('edição de clientes respeita escopo, cancela convites antigos e protege e-mail ativado', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const a = (await f.request('POST', '/api/clients',
      { name: 'Ana', email: 'ana-antigo@example.com' }, owner)).data.client;
    const b = (await f.request('POST', '/api/clients',
      { name: 'Bia', email: 'bia@example.com' }, owner)).data.client;
    const teamCreated = await f.request('POST', '/api/team', {
      name: 'Lia', email: 'lia@example.com',
      permissions: { clients: { read: true, write: true }, events: { read: true, write: true } },
    }, owner);
    const teamToken = new URL(teamCreated.data.inviteUrl).searchParams.get('token');
    const teamCookie = (await f.request('POST', '/api/team/invitations/accept',
      { token: teamToken, password: 'senha-equipe-lia-123' })).cookie;
    const event = (await f.request('POST', '/api/events', {
      ...eventPayload([a.id]), teamUserIds: [teamCreated.data.user.id],
    }, owner)).data.event;
    const invitation = await f.request('POST', `/api/events/${event.id}/invitations`,
      { clientId: a.id }, owner);
    const oldToken = new URL(invitation.data.inviteUrl).searchParams.get('token');
    const changed = await f.request('PATCH', `/api/clients/${a.id}`,
      { email: 'ana-novo@example.com', name: 'Ana Nova', phone: '11988887777' }, teamCookie);
    assert.equal(changed.status, 200);
    assert.equal(changed.data.client.email, 'ana-novo@example.com');
    assert.equal((await f.request('GET', `/api/invitations/preview?token=${oldToken}`)).status, 404);
    assert.equal((await f.request('PATCH', `/api/clients/${b.id}`,
      { name: 'Tentativa' }, teamCookie)).status, 404);
    const newInvitation = await f.request('POST', `/api/events/${event.id}/invitations`,
      { clientId: a.id }, owner);
    const token = new URL(newInvitation.data.inviteUrl).searchParams.get('token');
    assert.equal((await f.request('POST', '/api/invitations/accept',
      { token, password: 'senha-cliente-ana-123' })).status, 200);
    assert.equal((await f.request('PATCH', `/api/clients/${a.id}`,
      { email: 'outro@example.com' }, owner)).status, 409);
    assert.equal((await f.request('PATCH', `/api/clients/${a.id}`,
      { phone: '11977776666' }, owner)).status, 200);
    const config = await f.request('GET', '/api/config');
    assert.equal(config.status, 200);
    assert.equal(config.data.defaultTimezone, 'America/Sao_Paulo');
    assert.equal(typeof config.data.brandName, 'string');
  } finally { await f.cleanup(); }
});

test('calendário usa o fuso do evento na virada de mês, salvo fuso explícito', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const created = await f.request('POST', '/api/events', {
      ...eventPayload([], 'Evento em Manaus'),
      startAt: '2027-07-01T03:30:00.000Z', endAt: '2027-07-01T05:30:00.000Z',
      timezone: 'America/Manaus',
    }, owner);
    assert.equal(created.status, 201);
    const id = created.data.event.id;
    const june = await f.request('GET', '/api/calendar?month=2027-06', undefined, owner);
    assert.deepEqual(june.data.events.map((event) => event.id), [id]);
    const july = await f.request('GET', '/api/calendar?month=2027-07', undefined, owner);
    assert.deepEqual(july.data.events, []);
    const saoPaulo = await f.request('GET',
      '/api/calendar?month=2027-07&timezone=America%2FSao_Paulo', undefined, owner);
    assert.deepEqual(saoPaulo.data.events.map((event) => event.id), [id]);
  } finally { await f.cleanup(); }
});

test('link de recuperação expira ao usar e invalida sessões anteriores', async () => {
  const f = await fixture();
  try {
    const loggedIn = await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' });
    const owner = loggedIn.cookie;
    const link = await f.request('POST', `/api/admin/users/${loggedIn.data.user.id}/reset-link`, {}, owner);
    assert.equal(link.status, 201);
    assert.equal(link.data.delivery, 'manual');
    const token = new URL(link.data.resetUrl).searchParams.get('token');
    assert.equal((await f.request('GET', `/api/auth/reset/preview?token=${token}`)).status, 200);
    const parallelToken = 'outro-link-pendente-de-teste';
    f.database().prepare(`INSERT INTO password_resets
      (token_hash, user_id, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tokenHash(parallelToken), loggedIn.data.user.id,
        new Date(Date.now() + 3600_000).toISOString(), loggedIn.data.user.id, new Date().toISOString());
    assert.equal((await f.request('POST', '/api/auth/reset',
      { token, password: 'nova-senha-segura-123' })).status, 200);
    assert.equal((await f.request('GET', '/api/me', undefined, owner)).status, 401);
    assert.equal((await f.request('POST', '/api/auth/reset',
      { token, password: 'outra-senha-segura-123' })).status, 404);
    assert.equal((await f.request('GET', `/api/auth/reset/preview?token=${parallelToken}`)).status, 404);
    assert.equal((await f.request('POST', '/api/auth/reset',
      { token: parallelToken, password: 'outra-senha-segura-123' })).status, 404);
    assert.equal((await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'nova-senha-segura-123' })).status, 200);
  } finally { await f.cleanup(); }
});

test('desvincular cliente cancela convite pendente mesmo após novo vínculo', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const client = (await f.request('POST', '/api/clients',
      { name: 'Cliente', email: 'convite@example.com' }, owner)).data.client;
    const event = (await f.request('POST', '/api/events', eventPayload([client.id]), owner)).data.event;
    const invitation = await f.request('POST', `/api/events/${event.id}/invitations`,
      { clientId: client.id }, owner);
    const token = new URL(invitation.data.inviteUrl).searchParams.get('token');
    assert.equal((await f.request('GET', `/api/invitations/preview?token=${token}`)).status, 200);
    assert.equal((await f.request('PATCH', `/api/events/${event.id}`,
      { clientIds: [] }, owner)).status, 200);
    assert.equal((await f.request('GET', `/api/invitations/preview?token=${token}`)).status, 404);
    assert.equal((await f.request('POST', '/api/invitations/accept',
      { token, password: 'senha-cliente-123' })).status, 404);
    assert.equal((await f.request('PATCH', `/api/events/${event.id}`,
      { clientIds: [client.id] }, owner)).status, 200);
    assert.equal((await f.request('GET', `/api/invitations/preview?token=${token}`)).status, 404);
  } finally { await f.cleanup(); }
});

test('permissão e vínculo são revalidados após receber o corpo da requisição', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const invited = await f.request('POST', '/api/team', {
      name: 'Equipe', email: 'equipe-pausa@example.com',
      permissions: { events: { read: true, write: true }, clients: { read: true, write: true } },
    }, owner);
    const teamId = invited.data.user.id;
    const teamToken = new URL(invited.data.inviteUrl).searchParams.get('token');
    const teamCookie = (await f.request('POST', '/api/team/invitations/accept',
      { token: teamToken, password: 'senha-equipe-pausa-123' })).cookie;
    const client = (await f.request('POST', '/api/clients',
      { name: 'Cliente', email: 'cliente-pausa@example.com' }, owner)).data.client;
    const event = (await f.request('POST', '/api/events', {
      ...eventPayload([client.id]), teamUserIds: [teamId],
    }, owner)).data.event;

    const eventEdit = slowJsonRequest(f.baseUrl(), 'PATCH', `/api/events/${event.id}`,
      teamCookie, '{"name":"');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await f.request('PATCH', `/api/events/${event.id}`,
      { teamUserIds: [] }, owner)).status, 200);
    eventEdit.finish('Alteração indevida"}');
    assert.equal((await eventEdit.result).status, 404);
    assert.equal((await f.request('GET', `/api/events/${event.id}`, undefined, owner)).data.event.name,
      event.name);

    const clientEdit = slowJsonRequest(f.baseUrl(), 'PATCH', `/api/clients/${client.id}`,
      teamCookie, '{"phone":"');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await f.request('PATCH', `/api/team/${teamId}/permissions`, {
      permissions: { events: { read: true, write: true }, clients: { read: true, write: false } },
    }, owner)).status, 200);
    clientEdit.finish('999999999"}');
    assert.equal((await clientEdit.result).status, 403);
    assert.equal((await f.request('GET', '/api/clients', undefined, owner)).data.clients[0].phone, '');
  } finally { await f.cleanup(); }
});

test('listagens incluem registros além dos limites antigos', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST', '/api/auth/login',
      { email: 'dona@example.com', password: 'senha-segura-123' })).cookie;
    const db = f.database();
    const timestamp = new Date().toISOString();
    const insertClient = db.prepare(`INSERT INTO clients
      (id, name, email, phone, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)`);
    const insertEvent = db.prepare(`INSERT INTO events
      (id, code, name, type, status, start_at, timezone, created_at, updated_at)
      VALUES (?, ?, ?, 'casamento', 'orcamento', '2027-06-19T19:00:00.000Z',
        'America/Sao_Paulo', ?, ?)`);
    db.exec('BEGIN');
    try {
      for (let i = 0; i < 301; i++) {
        insertClient.run(`client-${i}`, `Cliente ${i}`, `cliente-${i}@example.com`, timestamp, timestamp);
      }
      for (let i = 0; i < 501; i++) {
        insertEvent.run(`event-${i}`, `EVT-2027-${i}`, `Evento ${i}`, timestamp, timestamp);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const clients = await f.request('GET', '/api/clients', undefined, owner);
    const events = await f.request('GET', '/api/events', undefined, owner);
    assert.equal(clients.status, 200);
    assert.equal(events.status, 200);
    assert.equal(clients.data.clients.length, 301);
    assert.equal(events.data.events.length, 501);
    assert.ok(clients.data.clients.some((row) => row.id === 'client-300'));
    assert.ok(events.data.events.some((row) => row.id === 'event-500'));
  } finally { await f.cleanup(); }
});
