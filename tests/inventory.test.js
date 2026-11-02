import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'eventos-inventory-'));
  const app = createApp({ dbPath: join(dir, 'db.sqlite') });
  app.db.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at)
    VALUES (?, 'Dona', 'dona@example.com', ?, 'owner', ?)`)
    .run(randomUUID(), hashPassword('senha-segura-123'), new Date().toISOString());
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (method, path, body, cookie) => {
    const response = await fetch(base + path, { method, headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async (email = 'dona@example.com', password = 'senha-segura-123') =>
    (await request('POST', '/api/auth/login', { email, password })).cookie;
  const cleanup = async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { app, base, request, login, cleanup };
}

const eventData = (name) => ({ name, type: 'casamento', status: 'contratado',
  startAt: '2027-06-19T19:00:00.000Z', timezone: 'America/Sao_Paulo' });

test('fornecedores, ofertas, estoque e fotos privadas persistem com validação', async () => {
  const f = await fixture();
  try {
    const owner = await f.login();
    assert.equal((await f.request('POST', '/api/suppliers', { category: 'Flores' }, owner)).status, 422);
    const supplier = await f.request('POST', '/api/suppliers', {
      name: 'Acervo Exemplo', category: 'Mobiliário', contactName: 'Maria',
      email: 'maria@example.com', phone: '(11) 99999-0000', website: 'https://example.com',
      offerings: [{ name: 'Cadeiras de madeira', category: 'Mobiliário', unit: 'unidade' }],
    }, owner);
    assert.equal(supplier.status, 201);
    assert.equal(supplier.data.supplier.offerings[0].name, 'Cadeiras de madeira');
    const id = supplier.data.supplier.id;
    const edited = await f.request('PATCH', `/api/suppliers/${id}`, {
      phone: '(11) 98888-0000', offerings: [{ name: 'Cadeiras e mesas', unit: 'unidade' }],
    }, owner);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.supplier.phone, '(11) 98888-0000');
    assert.equal(edited.data.supplier.offerings[0].name, 'Cadeiras e mesas');

    const item = await f.request('POST', '/api/inventory/items', {
      name: 'Cadeira de madeira', category: 'Cadeiras', ownership: 'rental',
      supplierId: id, dimensions: '45 × 90 cm', stockQty: 10,
    }, owner);
    assert.equal(item.status, 201);
    assert.equal(item.data.item.stockQty, 10);
    const itemId = item.data.item.id;
    assert.equal((await f.request('PATCH', `/api/inventory/items/${itemId}`,
      { stockQty: 99 }, owner)).status, 422);
    const move = await f.request('POST', `/api/inventory/items/${itemId}/movements`,
      { type: 'out', quantity: 2, reason: 'Avaria' }, owner);
    assert.equal(move.status, 201);
    assert.equal(move.data.item.stockQty, 8);
    assert.equal((await f.request('POST', `/api/inventory/items/${itemId}/movements`,
      { type: 'out', quantity: 9, reason: 'Baixa' }, owner)).status, 409);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    const upload = await fetch(`${f.base}/api/inventory/items/${itemId}/photos`, {
      method: 'POST', headers: { Cookie: owner, 'Content-Type': 'image/png',
        'X-File-Name': encodeURIComponent('cadeira.png') }, body: png,
    });
    assert.equal(upload.status, 201);
    const photo = (await upload.json()).photo;
    assert.equal(photo.mimeType, 'image/png');
    const image = await fetch(`${f.base}${photo.url}`, { headers: { Cookie: owner } });
    assert.equal(image.status, 200);
    assert.equal(Buffer.from(await image.arrayBuffer()).equals(png), true);
    assert.equal((await fetch(`${f.base}${photo.url}`)).status, 401);
    const bad = await fetch(`${f.base}/api/inventory/items/${itemId}/photos`, {
      method: 'POST', headers: { Cookie: owner, 'Content-Type': 'image/png' },
      body: Buffer.from('<script>alert(1)</script>'),
    });
    assert.equal(bad.status, 422);
    assert.equal((await f.request('GET', `/api/inventory/items/${itemId}`, undefined, owner))
      .data.movements.length, 2); // Estoque inicial e baixa.
    assert.equal((await f.request('DELETE', photo.url, undefined, owner)).status, 200);
    assert.equal((await fetch(`${f.base}${photo.url}`, { headers: { Cookie: owner } })).status, 404);
  } finally { await f.cleanup(); }
});

test('reservas consideram intervalo e pico simultâneo; baixa não rompe reservas', async () => {
  const f = await fixture();
  try {
    const owner = await f.login();
    const eventA = (await f.request('POST', '/api/events', eventData('A'), owner)).data.event;
    const eventB = (await f.request('POST', '/api/events', eventData('B'), owner)).data.event;
    const item = (await f.request('POST', '/api/inventory/items', {
      name: 'Mesa', category: 'Mesas', stockQty: 3,
    }, owner)).data.item;
    const reserve = (eventId, quantity, startAt, endAt) => f.request('POST',
      '/api/inventory/reservations', { itemId: item.id, eventId, quantity, startAt, endAt }, owner);
    const a = await reserve(eventA.id, 2, '2027-06-19T08:00:00Z', '2027-06-20T08:00:00Z');
    assert.equal(a.status, 201);
    assert.equal((await reserve(eventB.id, 2, '2027-06-19T12:00:00Z',
      '2027-06-20T12:00:00Z')).status, 409);
    const b = await reserve(eventB.id, 2, '2027-06-20T08:00:00Z',
      '2027-06-21T08:00:00Z');
    assert.equal(b.status, 201); // Retirada exatamente após a devolução anterior.
    assert.equal((await reserve(eventA.id, 2, '2027-06-19T10:00:00Z',
      '2027-06-21T06:00:00Z')).status, 409);
    const bridge = await reserve(eventA.id, 1, '2027-06-19T10:00:00Z',
      '2027-06-21T06:00:00Z');
    assert.equal(bridge.status, 201); // Pico é 3, não soma de reservas não simultâneas.
    assert.equal((await f.request('POST', `/api/inventory/items/${item.id}/movements`, {
      type: 'out', quantity: 1, reason: 'Perda', eventId: eventA.id,
    }, owner)).status, 409);
    assert.equal((await f.request('PATCH', `/api/inventory/reservations/${bridge.data.reservation.id}`,
      { status: 'released' }, owner)).status, 200);
    const move = await f.request('POST', `/api/inventory/items/${item.id}/movements`, {
      type: 'out', quantity: 1, reason: 'Perda', eventId: eventA.id,
    }, owner);
    assert.equal(move.status, 201);
    assert.equal(move.data.item.stockQty, 2);
    assert.equal((await f.request('GET', `/api/inventory/reservations?eventId=${eventA.id}`,
      undefined, owner)).data.reservations.length, 2);
  } finally { await f.cleanup(); }
});

test('equipe só vê reservas de eventos vinculados; cliente não acessa acervo interno', async () => {
  const f = await fixture();
  try {
    const owner = await f.login();
    const invitation = await f.request('POST', '/api/team', {
      name: 'Produção', email: 'producao@example.com',
      permissions: { inventory: { read: true, write: true },
        suppliers: { read: true, write: false } },
    }, owner);
    const teamId = invitation.data.user.id;
    const token = new URL(invitation.data.inviteUrl).searchParams.get('token');
    const team = (await f.request('POST', '/api/team/invitations/accept',
      { token, password: 'senha-equipe-123' })).cookie;
    const eventA = (await f.request('POST', '/api/events', {
      ...eventData('A'), teamUserIds: [teamId],
    }, owner)).data.event;
    const eventB = (await f.request('POST', '/api/events', eventData('B'), owner)).data.event;
    const item = (await f.request('POST', '/api/inventory/items', {
      name: 'Vaso', category: 'Vasos', stockQty: 2,
    }, owner)).data.item;
    const reserve = (eventId) => f.request('POST', '/api/inventory/reservations', {
      eventId, itemId: item.id, quantity: 1,
      startAt: '2027-06-18T08:00:00Z', endAt: '2027-06-19T08:00:00Z',
    }, owner);
    await reserve(eventA.id); await reserve(eventB.id);
    assert.deepEqual((await f.request('GET', '/api/inventory/events', undefined, team))
      .data.events.map((entry) => entry.id), [eventA.id]);
    assert.deepEqual((await f.request('GET', '/api/inventory/reservations', undefined, team))
      .data.reservations.map((entry) => entry.eventId), [eventA.id]);
    assert.equal((await f.request('GET', `/api/inventory/reservations?eventId=${eventB.id}`,
      undefined, team)).status, 404);
    assert.equal((await f.request('POST', '/api/inventory/reservations', {
      eventId: eventB.id, itemId: item.id, quantity: 1,
      startAt: '2027-06-20T08:00:00Z', endAt: '2027-06-21T08:00:00Z',
    }, team)).status, 404);
    assert.equal((await f.request('POST', '/api/suppliers', { name: 'Sem permissão' }, team)).status, 403);
    assert.equal((await f.request('GET', '/api/suppliers', undefined, team)).status, 200);
    const client = (await f.request('POST', '/api/clients', {
      name: 'Noiva', email: 'noiva@example.com',
    }, owner)).data.client;
    f.app.db.prepare(`INSERT INTO users (id, name, email, password_hash, role, client_id, created_at)
      VALUES (?, 'Noiva', 'noiva@example.com', ?, 'client', ?, ?)`)
      .run(randomUUID(), hashPassword('senha-noiva-123'), client.id, new Date().toISOString());
    const bride = await f.login('noiva@example.com', 'senha-noiva-123');
    assert.equal((await f.request('GET', '/api/inventory/items', undefined, bride)).status, 403);
    assert.equal((await f.request('GET', '/api/suppliers', undefined, bride)).status, 403);
  } finally { await f.cleanup(); }
});
