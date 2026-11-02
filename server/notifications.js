import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { transaction } from './db.js';

const OCCASIONS = new Set(['event_start', 'installment_due']);
const CHANNELS = new Set(['internal', 'email', 'whatsapp']);
const TOKENS = new Set(['cliente', 'evento', 'data_evento', 'hora_evento', 'local', 'parcela_valor', 'vencimento']);
const JOB_STATES = new Set(['scheduled', 'processing', 'sent', 'failed', 'cancelled']);
const MAX_OFFSET_MINUTES = 525_600;
const MAX_BODY = 4000;

const nowIso = () => new Date().toISOString();
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);
const datePt = date => date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';
const isIsoDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() + 1 === m && parsed.getUTCDate() === d;
};
function timeParts(iso, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function wallToIso(date, time, timezone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let utc = desired;
  for (let i = 0; i < 3; i++) {
    const parts = timeParts(new Date(utc).toISOString(), timezone);
    const [py, pm, pd] = parts.date.split('-').map(Number);
    const [ph, pmin] = parts.time.split(':').map(Number);
    utc += desired - Date.UTC(py, pm - 1, pd, ph, pmin);
  }
  const result = new Date(utc).toISOString();
  if (timeParts(result, timezone).date !== date || timeParts(result, timezone).time !== time) {
    throw new Error('Horário local inválido no fuso do evento.');
  }
  return result;
}

function field(value, label, max, required, fail) {
  if (value === undefined || value === null) {
    if (required) fail(422, `${label} é obrigatório.`);
    return '';
  }
  if (typeof value !== 'string') fail(422, `${label} deve ser texto.`);
  const clean = value.trim();
  if (required && !clean) fail(422, `${label} é obrigatório.`);
  if (clean.length > max) fail(422, `${label} excede ${max} caracteres.`);
  return clean;
}
function validateRule(body, fail) {
  const name = field(body.name, 'Nome', 120, true, fail);
  const occasion = field(body.occasion, 'Ocasião', 40, true, fail);
  const channel = field(body.channel, 'Canal', 20, true, fail);
  if (!OCCASIONS.has(occasion)) fail(422, 'Ocasião inválida.');
  if (!CHANNELS.has(channel)) fail(422, 'Canal inválido.');
  if (!Number.isInteger(body.offsetMinutes) || Math.abs(body.offsetMinutes) > MAX_OFFSET_MINUTES) {
    fail(422, 'Informe o intervalo em minutos, entre um ano antes e um ano depois.');
  }
  const sendTime = field(body.sendTime ?? '09:00', 'Horário local', 5, true, fail);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) fail(422, 'Horário local inválido.');
  const eventType = field(body.eventType, 'Tipo de evento', 20, false, fail);
  if (eventType && !['casamento', 'aniversario', 'corporativo', 'outro'].includes(eventType)) {
    fail(422, 'Tipo de evento inválido.');
  }
  const subjectTemplate = field(body.subjectTemplate, 'Assunto', 180, channel === 'email', fail);
  const bodyTemplate = field(body.bodyTemplate, 'Mensagem', MAX_BODY, channel !== 'whatsapp', fail);
  const whatsappTemplateName = field(body.whatsappTemplateName, 'Modelo do WhatsApp', 160,
    channel === 'whatsapp', fail);
  const whatsappLanguage = field(body.whatsappLanguage ?? 'pt_BR', 'Idioma do WhatsApp', 20,
    channel === 'whatsapp', fail);
  if (channel === 'whatsapp' && (!/^[a-z][a-z0-9_]*$/.test(whatsappTemplateName) ||
      !/^[a-z]{2}_[A-Z]{2}$/.test(whatsappLanguage))) fail(422, 'Modelo ou idioma do WhatsApp inválido.');
  const whatsappVariables = body.whatsappVariables ?? [];
  if (!Array.isArray(whatsappVariables) || whatsappVariables.length > 10 ||
      whatsappVariables.some(item => !TOKENS.has(item))) fail(422, 'Variáveis do WhatsApp inválidas.');
  const active = body.active === undefined ? true : body.active;
  if (typeof active !== 'boolean') fail(422, 'Situação inválida.');
  return { name, occasion, channel, offsetMinutes: body.offsetMinutes, sendTime, eventType,
    subjectTemplate, bodyTemplate, whatsappTemplateName, whatsappLanguage, whatsappVariables, active };
}
function ruleDto(row) {
  return { id: row.id, name: row.name, occasion: row.occasion, channel: row.channel,
    offsetMinutes: row.offset_minutes, sendTime: row.send_time, eventType: row.event_type || null,
    subjectTemplate: row.subject_template, bodyTemplate: row.body_template,
    whatsappTemplateName: row.whatsapp_template_name, whatsappLanguage: row.whatsapp_language,
    whatsappVariables: JSON.parse(row.whatsapp_variables_json), active: Boolean(row.active),
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function renderTemplate(template, values) {
  return template.replace(/\{([a-z_]+)\}/g, (full, name) => TOKENS.has(name) ? String(values[name] ?? '') : full);
}
function clientRows(db, eventId) {
  return db.prepare(`SELECT c.id, c.name, c.email, c.phone, u.id AS user_id,
    COALESCE(p.email_opt_in, 0) AS email_opt_in,
    COALESCE(p.whatsapp_opt_in, 0) AS whatsapp_opt_in
    FROM event_clients ec JOIN clients c ON c.id = ec.client_id
    LEFT JOIN users u ON u.client_id = c.id AND u.role = 'client' AND u.active = 1
    LEFT JOIN message_preferences p ON p.client_id = c.id
    WHERE ec.event_id = ? ORDER BY c.id`).all(eventId);
}
function eligibleClient(rule, client) {
  if (rule.channel === 'internal') return Boolean(client.user_id);
  if (rule.channel === 'email') return Boolean(client.email_opt_in) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email);
  return Boolean(client.whatsapp_opt_in) && /^\+[1-9]\d{8,14}$/.test(client.phone);
}
function templateValues(event, client, installment) {
  const local = timeParts(event.start_at, event.timezone);
  return {
    cliente: client.name, evento: event.name, data_evento: datePt(local.date),
    hora_evento: local.time, local: event.reception_name || event.ceremony_name || event.city || '',
    parcela_valor: installment ? money(installment.amount_cents) : '',
    vencimento: installment ? datePt(installment.due_date) : '',
  };
}
function desiredJobs(db, now) {
  const desired = new Map();
  const rules = db.prepare('SELECT * FROM message_rules WHERE active = 1').all();
  const events = db.prepare(`SELECT * FROM events WHERE status IN ('contratado','em_execucao','concluido')`).all();
  for (const event of events) {
    const clients = clientRows(db, event.id);
    for (const rule of rules) {
      if (rule.event_type && rule.event_type !== event.type) continue;
      const sources = rule.occasion === 'event_start'
        ? [{ type: 'event', id: event.id, anchor: event.start_at, installment: null }]
        : db.prepare(`SELECT i.*, a.client_id FROM financial_installments i
          JOIN financial_accounts a ON a.id = i.account_id
          WHERE a.event_id = ? AND a.direction = 'receivable' AND a.shared_with_client = 1`)
          .all(event.id).map(item => ({ type: 'installment', id: item.id,
            anchor: wallToIso(item.due_date, rule.send_time, event.timezone), installment: item }));
      for (const source of sources) {
        if (source.installment) {
          const paid = db.prepare(`SELECT COALESCE(SUM(pa.amount_cents),0) AS total
            FROM financial_payment_allocations pa JOIN financial_payments p ON p.id = pa.payment_id
            WHERE pa.installment_id = ? AND p.voided_at IS NULL`).get(source.id).total;
          if (paid >= source.installment.amount_cents) continue;
        }
        const scheduledAt = new Date(Date.parse(source.anchor) + rule.offset_minutes * 60_000).toISOString();
        for (const client of clients) {
          if (!eligibleClient(rule, client)) continue;
          if (source.installment?.client_id && source.installment.client_id !== client.id) continue;
          const values = templateValues(event, client, source.installment);
          const key = [rule.id, source.type, source.id, client.id, scheduledAt, rule.channel].join('|');
          desired.set(key, { rule, event, client, source, scheduledAt,
            subject: renderTemplate(rule.subject_template, values),
            body: renderTemplate(rule.body_template, values),
            whatsappVariables: JSON.parse(rule.whatsapp_variables_json).map(token => values[token] || ''),
            isFuture: scheduledAt > now });
        }
      }
    }
  }
  return desired;
}

export function syncAutomations(db, { now = nowIso() } = {}) {
  const desired = desiredJobs(db, now);
  let created = 0; let cancelled = 0; let updated = 0;
  transaction(db, () => {
    const existing = db.prepare(`SELECT * FROM message_jobs WHERE status IN ('scheduled','failed')`).all();
    for (const job of existing) {
      const key = [job.rule_id, job.source_type, job.source_id, job.client_id,
        job.scheduled_at, job.channel].join('|');
      if (!desired.has(key)) {
        db.prepare(`UPDATE message_jobs SET status = 'cancelled', cancelled_at = ?, updated_at = ?
          WHERE id = ? AND status IN ('scheduled','failed')`).run(now, now, job.id);
        cancelled++;
      }
    }
    for (const item of desired.values()) {
      const row = db.prepare(`SELECT * FROM message_jobs WHERE rule_id = ? AND source_type = ?
        AND source_id = ? AND client_id = ? AND scheduled_at = ? AND channel = ?`)
        .get(item.rule.id, item.source.type, item.source.id, item.client.id,
          item.scheduledAt, item.rule.channel);
      if (row) {
        if (row.status === 'scheduled') {
          const variables = JSON.stringify(item.whatsappVariables);
          if (row.recipient_user_id !== item.client.user_id ||
              row.subject !== item.subject || row.body !== item.body ||
              row.whatsapp_variables_json !== variables) {
            db.prepare(`UPDATE message_jobs SET recipient_user_id = ?, subject = ?, body = ?,
              whatsapp_variables_json = ?, updated_at = ? WHERE id = ?`)
              .run(item.client.user_id, item.subject, item.body, variables, now, row.id);
            updated++;
          }
        } else if (row.status === 'cancelled' && item.isFuture) {
          db.prepare(`UPDATE message_jobs SET status = 'scheduled', cancelled_at = NULL,
            recipient_user_id = ?, subject = ?, body = ?, whatsapp_variables_json = ?,
            updated_at = ? WHERE id = ?`)
            .run(item.client.user_id, item.subject, item.body,
              JSON.stringify(item.whatsappVariables), now, row.id);
          updated++;
        }
        continue;
      }
      if (!item.isFuture) continue;
      db.prepare(`INSERT INTO message_jobs (id, rule_id, event_id, source_type, source_id,
        client_id, recipient_user_id, channel, scheduled_at, status, subject, body,
        whatsapp_variables_json, retry_safe, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, 1, ?, ?)`)
        .run(randomUUID(), item.rule.id, item.event.id, item.source.type, item.source.id,
          item.client.id, item.client.user_id, item.rule.channel, item.scheduledAt,
          item.subject, item.body, JSON.stringify(item.whatsappVariables), now, now);
      created++;
    }
  });
  return { created, cancelled, updated };
}

function providerConfig() {
  return {
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
    whatsappConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_GRAPH_VERSION),
    workerEnabled: process.env.NOTIFICATIONS_WORKER !== 'false',
  };
}
function claimDueJob(db, id, now) {
  return transaction(db, () => {
    const claimed = db.prepare(`UPDATE message_jobs SET status = 'processing',
      attempt_count = attempt_count + 1, started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'scheduled' AND scheduled_at <= ?`)
      .run(now, now, id, now);
    if (claimed.changes !== 1) return null;
    const job = db.prepare('SELECT * FROM message_jobs WHERE id = ?').get(id);
    db.prepare(`INSERT INTO message_attempts (id, job_id, attempt_no, started_at, status)
      VALUES (?, ?, ?, ?, 'processing')`).run(randomUUID(), job.id, job.attempt_count, now);
    return job;
  });
}
function completeJob(db, job, { providerId = null, error = null, retrySafe = false }, now) {
  transaction(db, () => {
    if (providerId) {
      db.prepare(`UPDATE message_jobs SET status = 'sent', provider_message_id = ?,
        sent_at = ?, last_error = '', retry_safe = 0, updated_at = ? WHERE id = ? AND status = 'processing'`)
        .run(providerId, now, now, job.id);
    } else {
      db.prepare(`UPDATE message_jobs SET status = 'failed', last_error = ?, retry_safe = ?,
        updated_at = ? WHERE id = ? AND status = 'processing'`)
        .run(String(error || 'Falha sem confirmação do provedor.').slice(0, 500),
          retrySafe ? 1 : 0, now, job.id);
    }
    db.prepare(`UPDATE message_attempts SET status = ?, finished_at = ?, provider_message_id = ?,
      error = ? WHERE job_id = ? AND attempt_no = ? AND status = 'processing'`)
      .run(providerId ? 'sent' : 'failed', now, providerId,
        providerId ? '' : String(error || 'Falha sem confirmação do provedor.').slice(0, 500),
        job.id, job.attempt_count);
  });
}
function checkCurrentRecipient(db, job) {
  const relation = db.prepare(`SELECT c.name, c.email, c.phone, u.id AS user_id,
    COALESCE(p.email_opt_in, 0) AS email_opt_in,
    COALESCE(p.whatsapp_opt_in, 0) AS whatsapp_opt_in
    FROM event_clients ec JOIN clients c ON c.id = ec.client_id
    LEFT JOIN users u ON u.client_id = c.id AND u.role = 'client' AND u.active = 1
    LEFT JOIN message_preferences p ON p.client_id = c.id
    WHERE ec.event_id = ? AND c.id = ?`).get(job.event_id, job.client_id);
  if (!relation) return { error: 'Cliente não está mais vinculado ao evento.' };
  if (job.channel === 'internal') {
    if (!relation.user_id || relation.user_id !== job.recipient_user_id) {
      return { error: 'Acesso do cliente ao portal não está ativo.' };
    }
    return { recipient: relation };
  }
  if (job.channel === 'email') {
    if (!relation.email_opt_in) return { error: 'Cliente não autorizou e-mail.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(relation.email)) return { error: 'E-mail do cliente inválido.' };
    return { recipient: relation };
  }
  if (!relation.whatsapp_opt_in) return { error: 'Cliente não autorizou WhatsApp.' };
  if (!/^\+[1-9]\d{8,14}$/.test(relation.phone)) {
    return { error: 'Telefone deve estar no formato internacional, como +5511999999999.' };
  }
  return { recipient: relation };
}
async function sendEmail(job, recipient, fetchImpl) {
  if (!providerConfig().emailConfigured) return { error: 'Resend não configurado.', retrySafe: true };
  const subject = job.subject.replace(/[\r\n]+/g, ' ').slice(0, 180);
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': job.id,
      },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [recipient.email],
        subject, text: job.body }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: 'Não houve confirmação do provedor de e-mail; confira no Resend antes de repetir.', retrySafe: false };
  }
  if (!response.ok) return { error: `Resend recusou o envio (HTTP ${response.status}).`,
    retrySafe: response.status < 500 && response.status !== 408 && response.status !== 429 };
  let data;
  try { data = await response.json(); } catch { /* Resposta sem ID é ambígua. */ }
  if (!data?.id || typeof data.id !== 'string') {
    return { error: 'Resend não confirmou o identificador da mensagem.', retrySafe: false };
  }
  return { providerId: data.id };
}
async function sendWhatsApp(db, job, recipient, fetchImpl) {
  if (!providerConfig().whatsappConfigured) return { error: 'WhatsApp Cloud API não configurada.', retrySafe: true };
  const rule = db.prepare('SELECT * FROM message_rules WHERE id = ?').get(job.rule_id);
  if (!rule || !rule.active || !rule.whatsapp_template_name) {
    return { error: 'Modelo do WhatsApp indisponível.', retrySafe: true };
  }
  const version = process.env.WHATSAPP_GRAPH_VERSION;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(phoneId)) {
    return { error: 'Configuração do WhatsApp inválida.', retrySafe: true };
  }
  const variables = JSON.parse(job.whatsapp_variables_json);
  const template = { name: rule.whatsapp_template_name,
    language: { code: rule.whatsapp_language } };
  if (variables.length) template.components = [{ type: 'body',
    parameters: variables.map(value => ({ type: 'text', text: String(value) })) }];
  let response;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient.phone.slice(1),
        type: 'template', template }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: 'WhatsApp não confirmou o envio; confira no Meta antes de repetir.', retrySafe: false };
  }
  if (!response.ok) return { error: `WhatsApp recusou o envio (HTTP ${response.status}).`,
    retrySafe: response.status < 500 && response.status !== 408 && response.status !== 429 };
  let data;
  try { data = await response.json(); } catch { /* Resposta ambígua. */ }
  const id = data?.messages?.[0]?.id;
  if (typeof id !== 'string' || !id) {
    return { error: 'WhatsApp não confirmou o identificador da mensagem.', retrySafe: false };
  }
  return { providerId: id };
}
export function recoverInterruptedNotifications(db, { now = nowIso() } = {}) {
  const cutoff = new Date(Date.parse(now) - 10 * 60_000).toISOString();
  return transaction(db, () => {
    const rows = db.prepare(`SELECT id, attempt_count FROM message_jobs
      WHERE status = 'processing' AND started_at <= ?`).all(cutoff);
    for (const row of rows) {
      db.prepare(`UPDATE message_jobs SET status = 'failed', retry_safe = 0,
        last_error = 'Processamento interrompido; confira o provedor antes de repetir.',
        updated_at = ? WHERE id = ?`).run(now, row.id);
      db.prepare(`UPDATE message_attempts SET status = 'failed', finished_at = ?,
        error = 'Processamento interrompido; entrega incerta.'
        WHERE job_id = ? AND attempt_no = ? AND status = 'processing'`)
        .run(now, row.id, row.attempt_count);
    }
    return rows.length;
  });
}
export async function processDueNotifications(db, { now = nowIso(), fetchImpl = fetch,
  limit = 20 } = {}) {
  const due = db.prepare(`SELECT id FROM message_jobs WHERE status = 'scheduled'
    AND scheduled_at <= ? ORDER BY scheduled_at, id LIMIT ?`).all(now, limit);
  const result = { sent: 0, failed: 0 };
  for (const row of due) {
    const job = claimDueJob(db, row.id, now);
    if (!job) continue;
    const current = checkCurrentRecipient(db, job);
    if (current.error) {
      completeJob(db, job, { error: current.error, retrySafe: true }, now);
      result.failed++;
      continue;
    }
    let delivery;
    if (job.channel === 'internal') delivery = { providerId: `internal:${job.id}` };
    else if (job.channel === 'email') delivery = await sendEmail(job, current.recipient, fetchImpl);
    else delivery = await sendWhatsApp(db, job, current.recipient, fetchImpl);
    completeJob(db, job, delivery, now);
    if (delivery.providerId) result.sent++;
    else result.failed++;
  }
  return result;
}
export function startNotificationsWorker(db, { intervalMs = 60_000,
  fetchImpl = fetch } = {}) {
  if (process.env.NOTIFICATIONS_WORKER === 'false') return () => {};
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      recoverInterruptedNotifications(db);
      syncAutomations(db);
      await processDueNotifications(db, { fetchImpl });
    } catch (error) { console.error('Falha ao processar notificações:', error); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}

function jobDto(row) {
  return { id: row.id, ruleId: row.rule_id, ruleName: row.rule_name,
    eventId: row.event_id, eventName: row.event_name, clientId: row.client_id,
    clientName: row.client_name, channel: row.channel, status: row.status,
    scheduledAt: row.scheduled_at, subject: row.subject, body: row.body,
    attemptCount: row.attempt_count, lastError: row.last_error,
    providerMessageId: row.provider_message_id, sentAt: row.sent_at,
    deliveredAt: row.delivered_at, readAt: row.read_at,
    retrySafe: Boolean(row.retry_safe), createdAt: row.created_at };
}
function clientOnly(user, fail) {
  if (user.role !== 'client' || !user.client_id) fail(403, 'Acesso exclusivo do cliente.');
}
function ownerOnly(user, fail) {
  if (user.role !== 'owner') fail(403, 'Ação exclusiva do proprietário.');
}
function scopedJob(db, user, id, fail) {
  const job = db.prepare(`SELECT j.* FROM message_jobs j WHERE j.id = ?`).get(id);
  if (!job || (user.role === 'team' && !db.prepare(`SELECT 1 FROM event_team
    WHERE event_id = ? AND user_id = ?`).get(job.event_id, user.id))) {
    fail(404, 'Mensagem não encontrada.');
  }
  return job;
}
export async function handleNotificationsApi({ db, req, res, url, user, json, bodyJson, fail,
  requirePermission, requireCurrentUser, audit }) {
  const path = url.pathname;
  const method = req.method || 'GET';
  if (path.startsWith('/api/portal/notifications') ||
      path === '/api/portal/notification-preferences') {
    clientOnly(user, fail);
    if (path === '/api/portal/notification-preferences') {
      if (method === 'GET') {
        const row = db.prepare('SELECT * FROM message_preferences WHERE client_id = ?').get(user.client_id);
        return json(res, 200, { emailOptIn: Boolean(row?.email_opt_in),
          whatsappOptIn: Boolean(row?.whatsapp_opt_in) });
      }
      if (method === 'PATCH') {
        const body = await bodyJson(req);
        if (typeof body.emailOptIn !== 'boolean' || typeof body.whatsappOptIn !== 'boolean') {
          fail(422, 'Informe as preferências de e-mail e WhatsApp.');
        }
        const existing = db.prepare('SELECT * FROM message_preferences WHERE client_id = ?').get(user.client_id);
        if ((body.emailOptIn && !existing?.email_opt_in ||
             body.whatsappOptIn && !existing?.whatsapp_opt_in) && body.consentConfirmed !== true) {
          fail(422, 'Confirme a autorização para receber mensagens externas.');
        }
        transaction(db, () => {
          const current = requireCurrentUser(db, req, user);
          clientOnly(current, fail);
          db.prepare(`INSERT INTO message_preferences
            (client_id, email_opt_in, whatsapp_opt_in, consent_source, updated_at)
            VALUES (?, ?, ?, 'portal', ?)
            ON CONFLICT(client_id) DO UPDATE SET email_opt_in = excluded.email_opt_in,
              whatsapp_opt_in = excluded.whatsapp_opt_in,
              consent_source = 'portal', updated_at = excluded.updated_at`)
            .run(current.client_id, body.emailOptIn ? 1 : 0,
              body.whatsappOptIn ? 1 : 0, nowIso());
          audit(db, current.id, 'message_preferences', current.client_id, 'updated',
            { emailOptIn: body.emailOptIn, whatsappOptIn: body.whatsappOptIn });
        });
        syncAutomations(db);
        return json(res, 200, { emailOptIn: body.emailOptIn, whatsappOptIn: body.whatsappOptIn });
      }
      fail(405, 'Método não permitido.');
    }
    if (path === '/api/portal/notifications' && method === 'GET') {
      const rows = db.prepare(`SELECT j.id, j.event_id, e.name AS event_name, j.subject,
        j.body, j.sent_at, j.read_at FROM message_jobs j
        JOIN events e ON e.id = j.event_id
        JOIN event_clients ec ON ec.event_id = j.event_id AND ec.client_id = ?
        WHERE j.recipient_user_id = ? AND j.channel = 'internal' AND j.status = 'sent'
        ORDER BY j.sent_at DESC LIMIT 100`).all(user.client_id, user.id);
      return json(res, 200, { notifications: rows.map(row => ({ id: row.id,
        eventId: row.event_id, eventName: row.event_name, subject: row.subject,
        body: row.body, sentAt: row.sent_at, readAt: row.read_at })) });
    }
    const readMatch = path.match(/^\/api\/portal\/notifications\/([^/]+)\/read$/);
    if (readMatch && method === 'POST') {
      transaction(db, () => {
        const current = requireCurrentUser(db, req, user);
        clientOnly(current, fail);
        const changed = db.prepare(`UPDATE message_jobs SET read_at = COALESCE(read_at, ?),
          updated_at = ? WHERE id = ? AND recipient_user_id = ?
          AND channel = 'internal' AND status = 'sent' AND EXISTS (
            SELECT 1 FROM event_clients WHERE event_id = message_jobs.event_id AND client_id = ?)`)
          .run(nowIso(), nowIso(), readMatch[1], current.id, current.client_id);
        if (changed.changes !== 1) fail(404, 'Notificação não encontrada.');
      });
      return json(res, 200, { ok: true });
    }
    fail(404, 'Rota de notificação não encontrada.');
  }
  if (!path.startsWith('/api/messages')) return false;
  requirePermission(db, user, 'messages');

  if (path === '/api/messages/config' && method === 'GET') {
    return json(res, 200, providerConfig());
  }
  if (path === '/api/messages/rules' && method === 'GET') {
    return json(res, 200, { rules: db.prepare(`SELECT * FROM message_rules
      ORDER BY created_at DESC, id DESC`).all().map(ruleDto) });
  }
  if (path === '/api/messages/rules' && method === 'POST') {
    ownerOnly(user, fail);
    const data = validateRule(await bodyJson(req), fail);
    const id = randomUUID(); const timestamp = nowIso();
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user); ownerOnly(current, fail);
      db.prepare(`INSERT INTO message_rules (id, name, occasion, channel, offset_minutes,
        send_time, event_type, subject_template, body_template, whatsapp_template_name,
        whatsapp_language, whatsapp_variables_json, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, data.name, data.occasion, data.channel, data.offsetMinutes,
          data.sendTime, data.eventType, data.subjectTemplate, data.bodyTemplate,
          data.whatsappTemplateName, data.whatsappLanguage,
          JSON.stringify(data.whatsappVariables), data.active ? 1 : 0,
          current.id, timestamp, timestamp);
      audit(db, current.id, 'message_rule', id, 'created');
    });
    const scheduled = syncAutomations(db);
    return json(res, 201, { rule: ruleDto(db.prepare('SELECT * FROM message_rules WHERE id = ?').get(id)), scheduled });
  }
  const ruleMatch = path.match(/^\/api\/messages\/rules\/([^/]+)$/);
  if (ruleMatch && method === 'PATCH') {
    ownerOnly(user, fail);
    const old = db.prepare('SELECT * FROM message_rules WHERE id = ?').get(ruleMatch[1]);
    if (!old) fail(404, 'Regra não encontrada.');
    const body = await bodyJson(req);
    const merged = { ...ruleDto(old), ...body };
    const data = validateRule(merged, fail);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user); ownerOnly(current, fail);
      db.prepare(`UPDATE message_rules SET name = ?, occasion = ?, channel = ?,
        offset_minutes = ?, send_time = ?, event_type = ?, subject_template = ?,
        body_template = ?, whatsapp_template_name = ?, whatsapp_language = ?,
        whatsapp_variables_json = ?, active = ?, updated_at = ? WHERE id = ?`)
        .run(data.name, data.occasion, data.channel, data.offsetMinutes,
          data.sendTime, data.eventType, data.subjectTemplate, data.bodyTemplate,
          data.whatsappTemplateName, data.whatsappLanguage,
          JSON.stringify(data.whatsappVariables), data.active ? 1 : 0, nowIso(), old.id);
      audit(db, current.id, 'message_rule', old.id, 'updated');
    });
    const scheduled = syncAutomations(db);
    return json(res, 200, { rule: ruleDto(db.prepare('SELECT * FROM message_rules WHERE id = ?').get(old.id)), scheduled });
  }
  if (path === '/api/messages/sync' && method === 'POST') {
    ownerOnly(user, fail);
    return json(res, 200, syncAutomations(db));
  }
  if (path === '/api/messages/jobs' && method === 'GET') {
    const status = url.searchParams.get('status') || '';
    if (status && !JOB_STATES.has(status)) fail(422, 'Situação inválida.');
    const eventId = url.searchParams.get('eventId') || '';
    if (eventId && user.role === 'team' && !db.prepare(`SELECT 1 FROM event_team
      WHERE event_id = ? AND user_id = ?`).get(eventId, user.id)) fail(404, 'Evento não encontrado.');
    const clauses = []; const args = [];
    if (user.role === 'team') {
      clauses.push(`EXISTS (SELECT 1 FROM event_team et WHERE et.event_id = j.event_id AND et.user_id = ?)`);
      args.push(user.id);
    }
    if (status) { clauses.push('j.status = ?'); args.push(status); }
    if (eventId) { clauses.push('j.event_id = ?'); args.push(eventId); }
    const rows = db.prepare(`SELECT j.*, r.name AS rule_name, e.name AS event_name,
      c.name AS client_name FROM message_jobs j
      JOIN message_rules r ON r.id = j.rule_id
      JOIN events e ON e.id = j.event_id
      JOIN clients c ON c.id = j.client_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY j.scheduled_at DESC, j.id DESC LIMIT 300`).all(...args);
    return json(res, 200, { jobs: rows.map(jobDto) });
  }
  const retryMatch = path.match(/^\/api\/messages\/jobs\/([^/]+)\/retry$/);
  if (retryMatch && method === 'POST') {
    requirePermission(db, user, 'messages', 'edit');
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'messages', 'edit');
      const job = scopedJob(db, current, retryMatch[1], fail);
      if (job.status !== 'failed' || !job.retry_safe || job.provider_message_id) {
        fail(409, 'Esta mensagem não pode ser repetida com segurança. Confira o provedor.');
      }
      db.prepare(`UPDATE message_jobs SET status = 'scheduled', last_error = '',
        updated_at = ? WHERE id = ?`).run(nowIso(), job.id);
      audit(db, current.id, 'message_job', job.id, 'retry_requested');
    });
    return json(res, 200, { ok: true });
  }
  fail(404, 'Rota de mensagens não encontrada.');
}

// Meta chama este endpoint sem sessão. O segredo e o token de verificação nunca
// são enviados ao navegador; a assinatura HMAC autentica cada POST recebido.
export async function handleWhatsAppWebhook({ db, req, res, url, json, fail }) {
  if (url.pathname !== '/api/webhooks/whatsapp') return false;
  if (req.method === 'GET') {
    if (!process.env.WHATSAPP_VERIFY_TOKEN ||
        url.searchParams.get('hub.mode') !== 'subscribe' ||
        url.searchParams.get('hub.verify_token') !== process.env.WHATSAPP_VERIFY_TOKEN) {
      fail(403, 'Verificação do webhook recusada.');
    }
    const challenge = url.searchParams.get('hub.challenge') || '';
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(challenge);
    return true;
  }
  if (req.method !== 'POST') fail(405, 'Método não permitido.');
  if (!process.env.WHATSAPP_APP_SECRET) fail(503, 'Webhook do WhatsApp não configurado.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_048_576) fail(413, 'Webhook excede 1 MB.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const signature = req.headers['x-hub-signature-256'] || '';
  const expected = 'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
    .update(raw).digest('hex');
  const supplied = Buffer.from(String(signature));
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    fail(403, 'Assinatura do webhook inválida.');
  }
  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { fail(400, 'Webhook inválido.'); }
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const statuses = entries.flatMap(entry => (Array.isArray(entry?.changes) ? entry.changes : [])
    .flatMap(change => Array.isArray(change?.value?.statuses) ? change.value.statuses : []));
  transaction(db, () => {
    for (const status of statuses) {
      if (typeof status.id !== 'string') continue;
      const seconds = Number(status.timestamp);
      const at = Number.isFinite(seconds) && seconds > 0 && seconds < 8_640_000_000_000
        ? new Date(seconds * 1000).toISOString() : nowIso();
      if (status.status === 'delivered' || status.status === 'read') {
        db.prepare(`UPDATE message_jobs SET delivered_at = COALESCE(delivered_at, ?),
          updated_at = ? WHERE provider_message_id = ? AND channel = 'whatsapp'
          AND status = 'sent'`).run(at, nowIso(), status.id);
      } else if (status.status === 'failed') {
        db.prepare(`UPDATE message_jobs SET status = 'failed', retry_safe = 0,
          last_error = 'Meta informou falha de entrega.', updated_at = ?
          WHERE provider_message_id = ? AND channel = 'whatsapp'
          AND status = 'sent'`).run(nowIso(), status.id);
      }
    }
  });
  return json(res, 200, { ok: true });
}
