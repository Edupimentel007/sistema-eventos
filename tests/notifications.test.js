import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { handleWhatsAppWebhook, processDueNotifications, syncAutomations } from '../server/notifications.js';
import { createApp } from '../server/app.js';
import { createSession } from '../server/security.js';

function fixture() {
  const db = openDatabase(':memory:');
  const at = '2026-11-01T00:00:00.000Z';
  db.prepare(`INSERT INTO clients (id,name,email,phone,created_at,updated_at)
    VALUES ('client-a','Ana','ana@example.com','+5511999999999',?,?)`).run(at, at);
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role,client_id,created_at)
    VALUES ('user-a','Ana','ana@example.com','test','client','client-a',?)`).run(at);
  db.prepare(`INSERT INTO events (id,code,name,type,status,start_at,timezone,
    reception_name,created_at,updated_at)
    VALUES ('event-a','EVT-A','Casamento Ana','casamento','contratado',
    '2027-06-19T19:00:00.000Z','America/Sao_Paulo','Espaço Jardim',?,?)`).run(at, at);
  db.prepare(`INSERT INTO event_clients (event_id,client_id,created_at)
    VALUES ('event-a','client-a',?)`).run(at);
  return db;
}
function rule(db, { id = 'rule-a', occasion = 'event_start', channel = 'internal',
  offset = -10080, sendTime = '09:00' } = {}) {
  const at = '2026-11-01T00:00:00.000Z';
  db.prepare(`INSERT INTO message_rules (id,name,occasion,channel,offset_minutes,send_time,
    subject_template,body_template,whatsapp_template_name,whatsapp_language,
    whatsapp_variables_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'Lembrete: {evento}',
    'Olá {cliente}, seu evento será em {data_evento} às {hora_evento}.',
    'lembrete_evento','pt_BR','["cliente","evento"]',?,?)`)
    .run(id, `Regra ${id}`, occasion, channel, offset, sendTime, at, at);
}

test('agendamento interno é persistente, sem duplicação, e reagenda quando data muda', async () => {
  const db = fixture();
  try {
    rule(db);
    const base = '2027-06-01T00:00:00.000Z';
    assert.equal(syncAutomations(db, { now: base }).created, 1);
    assert.equal(syncAutomations(db, { now: base }).created, 0);
    const first = db.prepare('SELECT * FROM message_jobs').get();
    assert.equal(first.scheduled_at, '2027-06-12T19:00:00.000Z');
    assert.match(first.body, /Ana/);
    db.prepare(`UPDATE events SET start_at = '2027-06-20T19:00:00.000Z'
      WHERE id = 'event-a'`).run();
    const changed = syncAutomations(db, { now: base });
    assert.equal(changed.cancelled, 1);
    assert.equal(changed.created, 1);
    assert.equal(db.prepare(`SELECT status FROM message_jobs WHERE id = ?`).get(first.id).status,
      'cancelled');
    const next = db.prepare(`SELECT * FROM message_jobs WHERE status = 'scheduled'`).get();
    assert.equal(next.scheduled_at, '2027-06-13T19:00:00.000Z');
    const done = await processDueNotifications(db, { now: next.scheduled_at });
    assert.deepEqual(done, { sent: 1, failed: 0 });
    assert.equal((await processDueNotifications(db, { now: next.scheduled_at })).sent, 0);
    assert.equal(db.prepare('SELECT status FROM message_jobs WHERE id = ?').get(next.id).status,
      'sent');
    db.prepare(`UPDATE events SET status = 'cancelado' WHERE id = 'event-a'`).run();
    syncAutomations(db, { now: base });
    assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM message_jobs
      WHERE status = 'scheduled'`).get().total, 0);
  } finally { db.close(); }
});

test('vencimento financeiro respeita fuso local e cancela lembrete antigo', () => {
  const db = fixture();
  try {
    db.prepare(`INSERT INTO financial_accounts
      (id,direction,title,event_id,amount_cents,shared_with_client,created_at,updated_at)
      VALUES ('account-a','receivable','Parcela','event-a',10000,1,
      '2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO financial_installments
      (id,account_id,sequence,due_date,amount_cents,created_at,updated_at)
      VALUES ('installment-a','account-a',1,'2027-06-10',10000,
      '2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')`).run();
    rule(db, { occasion: 'installment_due', offset: -1440 });
    const now = '2027-06-01T00:00:00Z';
    assert.equal(syncAutomations(db, { now }).created, 1);
    const first = db.prepare(`SELECT * FROM message_jobs WHERE status = 'scheduled'`).get();
    assert.equal(first.scheduled_at, '2027-06-09T12:00:00.000Z');
    db.prepare(`UPDATE financial_installments SET due_date = '2027-06-11'
      WHERE id = 'installment-a'`).run();
    const changed = syncAutomations(db, { now });
    assert.equal(changed.cancelled, 1);
    assert.equal(changed.created, 1);
    const next = db.prepare(`SELECT * FROM message_jobs WHERE status = 'scheduled'`).get();
    assert.equal(next.scheduled_at, '2027-06-10T12:00:00.000Z');
    assert.match(next.body, /Ana/);
  } finally { db.close(); }
});

test('e-mail exige autorização e confirmação real do Resend; tentativa é idempotente', async () => {
  const db = fixture();
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.RESEND_FROM;
  try {
    rule(db, { channel: 'email' });
    const now = '2027-06-01T00:00:00Z';
    assert.equal(syncAutomations(db, { now }).created, 0);
    db.prepare(`INSERT INTO message_preferences
      (client_id,email_opt_in,updated_at) VALUES ('client-a',1,?)`).run(now);
    assert.equal(syncAutomations(db, { now }).created, 1);
    process.env.RESEND_API_KEY = 'test-only'; process.env.RESEND_FROM = 'Teste <teste@example.com>';
    const sent = [];
    const result = await processDueNotifications(db, {
      now: '2027-06-12T19:00:00.000Z',
      fetchImpl: async (url, options) => {
        sent.push({ url, options });
        return { ok: true, json: async () => ({ id: 'email-provider-id' }) };
      },
    });
    assert.deepEqual(result, { sent: 1, failed: 0 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.equal(sent[0].options.headers['Idempotency-Key'],
      db.prepare('SELECT id FROM message_jobs').get().id);
    assert.equal((await processDueNotifications(db, { now: '2027-06-12T19:00:00.000Z' })).sent, 0);
    const job = db.prepare('SELECT * FROM message_jobs').get();
    assert.equal(job.provider_message_id, 'email-provider-id');
    assert.equal(job.delivered_at, null);
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = oldFrom;
    db.close();
  }
});

test('Meta webhook só registra entrega com assinatura válida e id do provedor', async () => {
  const db = fixture();
  const oldSecret = process.env.WHATSAPP_APP_SECRET;
  try {
    process.env.WHATSAPP_APP_SECRET = 'segredo-teste';
    rule(db, { channel: 'whatsapp' });
    db.prepare(`INSERT INTO message_preferences
      (client_id,whatsapp_opt_in,updated_at) VALUES ('client-a',1,?)`)
      .run('2027-06-01T00:00:00Z');
    syncAutomations(db, { now: '2027-06-01T00:00:00Z' });
    db.prepare(`UPDATE message_jobs SET status = 'sent', provider_message_id = 'wamid-123',
      sent_at = '2027-06-12T19:00:00Z'`).run();
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{
      id: 'wamid-123', status: 'delivered', timestamp: '1812826800',
    }] } }] }] });
    const signature = 'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
      .update(raw).digest('hex');
    const result = {};
    const args = { db, req: { method: 'POST', headers: { 'x-hub-signature-256': signature },
      async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } },
    res: {}, url: new URL('http://localhost/api/webhooks/whatsapp'),
    json: (_res, status, body) => { result.status = status; result.body = body; },
    fail: (status, message) => { throw Object.assign(new Error(message), { status }); } };
    await handleWhatsAppWebhook(args);
    assert.equal(result.status, 200);
    assert.ok(db.prepare('SELECT delivered_at FROM message_jobs').get().delivered_at);
    await assert.rejects(handleWhatsAppWebhook({ ...args,
      req: { ...args.req, headers: { 'x-hub-signature-256': 'sha256=bad' } } }),
    error => error.status === 403);
  } finally {
    if (oldSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = oldSecret;
    db.close();
  }
});

test('API permite regras ao proprietário e isola preferências e caixa do cliente', async () => {
  const { server, db, stopNotifications } = createApp({ dbPath: ':memory:' });
  const at = '2026-11-01T00:00:00Z';
  try {
    db.prepare(`INSERT INTO users (id,name,email,password_hash,role,created_at)
      VALUES ('owner','Proprietário','owner@example.com','test','owner',?)`).run(at);
    db.prepare(`INSERT INTO clients (id,name,email,phone,created_at,updated_at)
      VALUES ('client-a','Ana','ana@example.com','+5511999999999',?,?)`).run(at, at);
    db.prepare(`INSERT INTO users (id,name,email,password_hash,role,client_id,created_at)
      VALUES ('user-a','Ana','ana@example.com','test','client','client-a',?)`).run(at);
    db.prepare(`INSERT INTO events (id,code,name,type,status,start_at,timezone,created_at,updated_at)
      VALUES ('event-a','EVT-A','Casamento Ana','casamento','contratado',
      '2027-06-19T19:00:00Z','America/Sao_Paulo',?,?)`).run(at, at);
    db.prepare(`INSERT INTO event_clients (event_id,client_id,created_at)
      VALUES ('event-a','client-a',?)`).run(at);
    const ownerCookie = `evento_session=${createSession(db, 'owner')}`;
    const clientCookie = `evento_session=${createSession(db, 'user-a')}`;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, cookie, method = 'GET', body) => {
      const response = await fetch(base + path, { method,
        headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json() };
    };
    const created = await call('/api/messages/rules', ownerCookie, 'POST', {
      name: 'Uma semana antes', occasion: 'event_start', channel: 'internal',
      offsetMinutes: -10080, sendTime: '09:00', eventType: 'casamento',
      subjectTemplate: 'Seu casamento', bodyTemplate: 'Olá {cliente}, {evento} em {data_evento}.',
      active: true,
    });
    assert.equal(created.status, 201);
    assert.equal((await call('/api/messages/rules', clientCookie)).status, 403);
    assert.equal((await call('/api/messages/jobs', ownerCookie)).data.jobs.length, 1);
    assert.equal((await call('/api/portal/notifications', clientCookie)).data.notifications.length, 0);
    const noConsent = await call('/api/portal/notification-preferences', clientCookie, 'PATCH',
      { emailOptIn: true, whatsappOptIn: false });
    assert.equal(noConsent.status, 422);
    const consent = await call('/api/portal/notification-preferences', clientCookie, 'PATCH',
      { emailOptIn: true, whatsappOptIn: false, consentConfirmed: true });
    assert.equal(consent.status, 200);
    assert.equal(consent.data.emailOptIn, true);
    assert.equal((await call('/api/portal/notification-preferences', ownerCookie)).status, 403);
  } finally {
    stopNotifications();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
