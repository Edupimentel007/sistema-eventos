import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { openDatabase, transaction } from './db.js';
import {
  authenticatedUser, clearSessionCookie, createSession, hashPassword, newToken,
  revokeSession, sessionCookie, tokenHash, verifyPassword,
} from './security.js';

const statuses = ['orcamento', 'negociacao', 'contratado', 'em_execucao', 'concluido', 'cancelado'];
const types = ['casamento', 'aniversario', 'corporativo', 'outro'];
const modules = ['dashboard', 'clients', 'events', 'calendar'];

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fail(status, message) { throw new ApiError(status, message); }
function nowIso() { return new Date().toISOString(); }

function json(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

async function bodyJson(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    fail(415, 'Envie os dados em JSON.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_048_576) fail(413, 'O conteúdo excede 1 MB.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'JSON inválido.');
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, 'JSON inválido.');
  }
}

function text(value, label, max = 255, required = false) {
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

function email(value) {
  const clean = text(value, 'E-mail', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) fail(422, 'E-mail inválido.');
  return clean;
}

function dateTime(value, label, required = false) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    fail(422, `${label} precisa incluir data, hora e fuso.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(422, `${label} inválido.`);
  return date.toISOString();
}

function integerOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) fail(422, `${label} inválido.`);
  return value;
}

function urlOrBlank(value, label) {
  const clean = text(value, label, 2048);
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') fail(422, `${label} deve usar HTTPS.`);
    return clean;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(422, `${label} inválido.`);
  }
}

function timezone(value) {
  const clean = text(value, 'Fuso horário', 100, true);
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: clean }); }
  catch { fail(422, 'Fuso horário inválido.'); }
  return clean;
}

function defaultTimezone() {
  const value = process.env.DEFAULT_TIMEZONE?.trim() || 'America/Sao_Paulo';
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }); return value; }
  catch { return 'America/Sao_Paulo'; }
}

function publicConfig() {
  const brandName = process.env.BRAND_NAME?.trim().slice(0, 120) || 'Jardim';
  const contactEmail = process.env.CONTACT_EMAIL?.trim().slice(0, 254) || '';
  const contactPhone = process.env.CONTACT_PHONE?.trim().slice(0, 40) || '';
  return { brandName, contactEmail, contactPhone, defaultTimezone: defaultTimezone() };
}

function requireUser(db, req) {
  const user = authenticatedUser(db, req);
  if (!user) fail(401, 'Faça login para continuar.');
  return user;
}

function requireCurrentUser(db, req, priorUser) {
  const current = requireUser(db, req);
  if (current.id !== priorUser.id) fail(401, 'Faça login para continuar.');
  return current;
}

function can(db, user, module, action = 'view') {
  if (user.role === 'owner') return true;
  if (user.role !== 'team') return false;
  const permission = db.prepare('SELECT can_view, can_edit FROM team_permissions WHERE user_id = ? AND module = ?')
    .get(user.id, module);
  return action === 'edit' ? permission?.can_edit === 1 : permission?.can_view === 1 || permission?.can_edit === 1;
}

function requirePermission(db, user, module, action = 'view') {
  if (!can(db, user, module, action)) fail(403, 'Você não tem permissão para esta ação.');
}

function requireOwner(user) {
  if (user.role !== 'owner') fail(403, 'Ação exclusiva do proprietário.');
}

function permissionsFor(db, user) {
  const result = {};
  for (const module of modules) {
    result[module] = { read: can(db, user, module), write: can(db, user, module, 'edit') };
  }
  result.team = { read: user.role === 'owner', write: user.role === 'owner' };
  return result;
}

function userDto(db, user) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role, jobTitle: user.job_title,
    clientId: user.client_id, permissions: permissionsFor(db, user),
  };
}

function clientDto(row) {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, createdAt: row.created_at };
}

function getEvent(db, id) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) fail(404, 'Evento não encontrado.');
  return row;
}

function eventClients(db, id, portal = false) {
  const rows = db.prepare(`SELECT c.* FROM clients c JOIN event_clients ec ON ec.client_id = c.id
    WHERE ec.event_id = ? ORDER BY c.name`).all(id);
  return rows.map((row) => portal ? { id: row.id, name: row.name } : clientDto(row));
}

function eventTeam(db, id) {
  return db.prepare(`SELECT u.id, u.name, u.email FROM users u JOIN event_team et ON et.user_id = u.id
    WHERE et.event_id = ? ORDER BY u.name`).all(id);
}

function eventDto(db, row, portal = false) {
  const base = {
    id: row.id, code: row.code, name: row.name, type: row.type, status: row.status,
    startAt: row.start_at, endAt: row.end_at, timezone: row.timezone,
    guestEstimated: row.guest_estimated, guestConfirmed: row.guest_confirmed,
    ceremonyName: row.ceremony_name, receptionName: row.reception_name,
    ceremonyAddress: row.ceremony_address, receptionAddress: row.reception_address,
    ceremonyMapUrl: row.ceremony_map_url, receptionMapUrl: row.reception_map_url,
    addressLine: row.address_line, city: row.city, state: row.state,
    postalCode: row.postal_code, mapUrl: row.map_url,
    clients: eventClients(db, row.id, portal),
    updatedAt: row.updated_at,
  };
  if (!portal) {
    base.internalNotes = row.internal_notes;
    base.clientIds = base.clients.map((client) => client.id);
    base.team = eventTeam(db, row.id);
    base.teamUserIds = base.team.map((user) => user.id);
    base.responsibleUserId = row.responsible_user_id;
    base.createdAt = row.created_at;
  }
  return base;
}

function calendarEventDto(row) {
  return {
    id: row.id, code: row.code, name: row.name, type: row.type, status: row.status,
    startAt: row.start_at, endAt: row.end_at, timezone: row.timezone,
    ceremonyName: row.ceremony_name, receptionName: row.reception_name, city: row.city,
  };
}

function eventInput(db, input, existing = null) {
  const current = existing ? eventDto(db, existing) : {};
  const value = (key) => Object.hasOwn(input, key) ? input[key] : current[key];
  const name = text(value('name'), 'Nome do evento', 200, true);
  const type = text(value('type') ?? 'casamento', 'Tipo', 30, true);
  const status = text(value('status') ?? 'orcamento', 'Situação', 30, true);
  if (!types.includes(type)) fail(422, 'Tipo de evento inválido.');
  if (!statuses.includes(status)) fail(422, 'Situação do evento inválida.');
  const startAt = dateTime(value('startAt'), 'Início', true);
  const endAt = dateTime(value('endAt'), 'Fim');
  if (endAt && endAt <= startAt) fail(422, 'O fim deve ser posterior ao início.');
  const tz = timezone(value('timezone') ?? defaultTimezone());
  const clientIds = value('clientIds') ?? [];
  if (!Array.isArray(clientIds) || clientIds.length > 20 || new Set(clientIds).size !== clientIds.length) {
    fail(422, 'Clientes vinculados inválidos.');
  }
  for (const clientId of clientIds) {
    if (typeof clientId !== 'string' || !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) {
      fail(422, 'Um cliente vinculado não foi encontrado.');
    }
  }
  const teamUserIds = value('teamUserIds') ?? [];
  if (!Array.isArray(teamUserIds) || teamUserIds.length > 50 || new Set(teamUserIds).size !== teamUserIds.length) {
    fail(422, 'Equipe vinculada inválida.');
  }
  for (const teamId of teamUserIds) {
    if (typeof teamId !== 'string' || !db.prepare("SELECT 1 FROM users WHERE id = ? AND role IN ('owner', 'team')").get(teamId)) {
      fail(422, 'Um integrante da equipe não foi encontrado.');
    }
  }
  const responsibleUserId = value('responsibleUserId') || null;
  if (responsibleUserId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND role IN ('owner', 'team') AND active = 1").get(responsibleUserId)) {
    fail(422, 'Responsável interno não encontrado.');
  }
  return {
    name, type, status, startAt, endAt, timezone: tz,
    guestEstimated: integerOrNull(value('guestEstimated'), 'Convidados estimados'),
    guestConfirmed: integerOrNull(value('guestConfirmed'), 'Convidados confirmados'),
    ceremonyName: text(value('ceremonyName'), 'Local da cerimônia', 255),
    receptionName: text(value('receptionName'), 'Local da festa', 255),
    ceremonyAddress: text(value('ceremonyAddress'), 'Endereço da cerimônia', 500),
    receptionAddress: text(value('receptionAddress'), 'Endereço da festa', 500),
    ceremonyMapUrl: urlOrBlank(value('ceremonyMapUrl'), 'Mapa da cerimônia'),
    receptionMapUrl: urlOrBlank(value('receptionMapUrl'), 'Mapa da festa'),
    addressLine: text(value('addressLine'), 'Endereço geral', 500),
    city: text(value('city'), 'Cidade', 150),
    state: text(value('state'), 'Estado', 100),
    postalCode: text(value('postalCode'), 'CEP', 20),
    mapUrl: urlOrBlank(value('mapUrl'), 'Mapa geral'),
    internalNotes: text(value('internalNotes'), 'Observações internas', 10000),
    responsibleUserId, clientIds, teamUserIds,
  };
}

function saveEventLinks(db, id, data) {
  const timestamp = nowIso();
  db.prepare('DELETE FROM event_clients WHERE event_id = ?').run(id);
  for (const clientId of data.clientIds) {
    db.prepare('INSERT INTO event_clients (event_id, client_id, created_at) VALUES (?, ?, ?)')
      .run(id, clientId, timestamp);
  }
  db.prepare('DELETE FROM event_team WHERE event_id = ?').run(id);
  for (const userId of data.teamUserIds) {
    db.prepare('INSERT INTO event_team (event_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(id, userId, timestamp);
  }
}

function audit(db, actorId, entityType, entityId, action, details = {}) {
  db.prepare(`INSERT INTO audit_log
    (id, actor_user_id, entity_type, entity_id, action, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), actorId, entityType, entityId, action, JSON.stringify(details), nowIso());
}

function linkedClient(db, user, eventId) {
  return user.role === 'client' && Boolean(user.client_id) && Boolean(db.prepare(
    'SELECT 1 FROM event_clients WHERE event_id = ? AND client_id = ?').get(eventId, user.client_id));
}

function teamHasEvent(db, user, eventId) {
  if (user.role === 'owner') return true;
  return user.role === 'team' && Boolean(db.prepare(
    'SELECT 1 FROM event_team WHERE event_id = ? AND user_id = ?').get(eventId, user.id));
}

function requireTeamEvent(db, user, eventId) {
  if (!teamHasEvent(db, user, eventId)) fail(404, 'Evento não encontrado.');
}

function teamCanUseClient(db, user, clientId) {
  if (user.role === 'owner') return true;
  return Boolean(db.prepare(`SELECT 1 FROM clients c WHERE c.id = ? AND
    (c.created_by = ? OR EXISTS (
      SELECT 1 FROM event_clients ec JOIN event_team et ON et.event_id = ec.event_id
      WHERE ec.client_id = c.id AND et.user_id = ?))`).get(clientId, user.id, user.id));
}

function requireUsableClients(db, user, clientIds) {
  if (user.role === 'owner') return;
  for (const clientId of clientIds) {
    if (!teamCanUseClient(db, user, clientId)) fail(403, 'Cliente fora do seu escopo de acesso.');
  }
}

function eventScope(user, alias = 'e') {
  return user.role === 'owner'
    ? { sql: '1 = 1', args: [] }
    : { sql: `EXISTS (SELECT 1 FROM event_team et WHERE et.event_id = ${alias}.id AND et.user_id = ?)`, args: [user.id] };
}

function eventList(db, filters = {}, user) {
  const clauses = [];
  const args = [];
  if (user) {
    const scope = eventScope(user);
    clauses.push(scope.sql);
    args.push(...scope.args);
  }
  if (filters.status) { clauses.push('e.status = ?'); args.push(filters.status); }
  if (filters.clientId) {
    clauses.push('EXISTS (SELECT 1 FROM event_clients ec WHERE ec.event_id = e.id AND ec.client_id = ?)');
    args.push(filters.clientId);
  }
  if (filters.responsibleUserId) { clauses.push('e.responsible_user_id = ?'); args.push(filters.responsibleUserId); }
  if (filters.from) { clauses.push('e.start_at >= ?'); args.push(filters.from); }
  if (filters.to) { clauses.push('e.start_at < ?'); args.push(filters.to); }
  if (filters.q) {
    clauses.push(`(e.name LIKE ? OR e.code LIKE ? OR e.city LIKE ? OR EXISTS
      (SELECT 1 FROM clients c JOIN event_clients ec ON ec.client_id = c.id
       WHERE ec.event_id = e.id AND c.name LIKE ?))`);
    args.push(...Array(4).fill(`%${filters.q}%`));
  }
  const sql = `SELECT e.* FROM events e ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY e.start_at ASC, e.name ASC`;
  return db.prepare(sql).all(...args);
}

function monthKey(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  return `${year}-${month}`;
}

function enforceSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host === req.headers.host) return;
  } catch { /* rejeita abaixo */ }
  fail(403, 'Origem da requisição não permitida.');
}

function publicBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${req.headers.host}`;
}

async function handleApi(db, req, res, url) {
  const method = req.method || 'GET';
  const path = url.pathname;
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) enforceSameOrigin(req);

  if (method === 'GET' && path === '/api/health') return json(res, 200, { status: 'ok' });
  if (method === 'GET' && path === '/api/config') return json(res, 200, publicConfig());

  if (method === 'POST' && path === '/api/auth/login') {
    const body = await bodyJson(req);
    const address = email(body.email);
    db.prepare('DELETE FROM auth_attempts WHERE expires_at < ?').run(nowIso());
    const attemptKey = tokenHash(`${req.socket.remoteAddress || 'unknown'}|${address}`);
    const attempt = db.prepare('SELECT * FROM auth_attempts WHERE attempt_key = ?').get(attemptKey);
    if (attempt && attempt.expires_at > nowIso() && attempt.failed_count >= 8) {
      fail(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(address);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      db.prepare(`INSERT INTO auth_attempts (attempt_key, failed_count, expires_at)
        VALUES (?, ?, ?) ON CONFLICT(attempt_key) DO UPDATE SET
        failed_count = CASE WHEN auth_attempts.expires_at > ? THEN auth_attempts.failed_count + 1 ELSE 1 END,
        expires_at = CASE WHEN auth_attempts.expires_at > ? THEN auth_attempts.expires_at ELSE excluded.expires_at END`)
        .run(attemptKey, 1, expiresAt, nowIso(), nowIso());
      fail(401, 'E-mail ou senha incorretos.');
    }
    db.prepare('DELETE FROM auth_attempts WHERE attempt_key = ?').run(attemptKey);
    const token = createSession(db, user.id);
    audit(db, user.id, 'session', user.id, 'login');
    return json(res, 200, { user: userDto(db, user) }, { 'Set-Cookie': sessionCookie(token, req) });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const user = authenticatedUser(db, req);
    revokeSession(db, req);
    if (user) audit(db, user.id, 'session', user.id, 'logout');
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  if (method === 'GET' && path === '/api/invitations/preview') {
    const token = url.searchParams.get('token');
    if (!token || token.length > 200) fail(404, 'Convite inválido ou expirado.');
    const invite = db.prepare(`SELECT i.*, e.name AS event_name, e.start_at AS event_start_at,
      c.name AS client_name, c.email AS client_email FROM invitations i
      JOIN events e ON e.id = i.event_id JOIN clients c ON c.id = i.client_id
      JOIN event_clients ec ON ec.event_id = i.event_id AND ec.client_id = i.client_id
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`)
      .get(tokenHash(token), nowIso());
    if (!invite) fail(404, 'Convite inválido ou expirado.');
    return json(res, 200, { invitation: {
      eventName: invite.event_name, startAt: invite.event_start_at,
      clientName: invite.client_name, email: invite.client_email,
      expiresAt: invite.expires_at,
    } });
  }

  if (method === 'POST' && path === '/api/invitations/accept') {
    const body = await bodyJson(req);
    const rawToken = text(body.token, 'Convite', 200, true);
    const invite = db.prepare(`SELECT i.*, c.name AS client_name, c.email AS client_email
      FROM invitations i JOIN clients c ON c.id = i.client_id
      JOIN event_clients ec ON ec.event_id = i.event_id AND ec.client_id = i.client_id
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`)
      .get(tokenHash(rawToken), nowIso());
    if (!invite) fail(404, 'Convite inválido ou expirado.');
    const name = text(body.name || invite.client_name, 'Nome', 150, true);
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(invite.client_email);
    let passwordHash = null;
    if (existing) {
      if (existing.role !== 'client' || existing.client_id !== invite.client_id || !existing.active ||
          !verifyPassword(body.password, existing.password_hash)) {
        fail(409, 'Esta conta já existe. Entre com a senha correta ou solicite recuperação de acesso.');
      }
    } else {
      try { passwordHash = hashPassword(body.password); }
      catch (error) { fail(422, error.message); }
    }
    const userId = transaction(db, () => {
      const claimed = db.prepare(`UPDATE invitations SET accepted_at = ? WHERE id = ?
        AND accepted_at IS NULL AND expires_at > ? AND EXISTS (
          SELECT 1 FROM event_clients ec
          WHERE ec.event_id = invitations.event_id AND ec.client_id = invitations.client_id)`)
        .run(nowIso(), invite.id, nowIso());
      if (claimed.changes !== 1) fail(404, 'Convite inválido ou expirado.');
      const id = existing?.id || randomUUID();
      if (!existing) db.prepare(`INSERT INTO users
        (id, name, email, password_hash, role, client_id, created_at)
        VALUES (?, ?, ?, ?, 'client', ?, ?)`)
        .run(id, name, invite.client_email, passwordHash, invite.client_id, nowIso());
      audit(db, id, 'invitation', invite.id, 'accepted', { eventId: invite.event_id });
      return id;
    });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const token = createSession(db, userId);
    return json(res, 200, { user: userDto(db, user), eventId: invite.event_id },
      { 'Set-Cookie': sessionCookie(token, req) });
  }

  if (method === 'GET' && path === '/api/team/invitations/preview') {
    const token = url.searchParams.get('token');
    if (!token || token.length > 200) fail(404, 'Convite inválido ou expirado.');
    const invite = db.prepare(`SELECT ti.expires_at, u.name, u.email, u.job_title
      FROM team_invitations ti JOIN users u ON u.id = ti.user_id
      WHERE ti.token_hash = ? AND ti.accepted_at IS NULL AND ti.expires_at > ? AND u.active = 0`)
      .get(tokenHash(token), nowIso());
    if (!invite) fail(404, 'Convite inválido ou expirado.');
    return json(res, 200, { invitation: {
      name: invite.name, email: invite.email, jobTitle: invite.job_title,
      expiresAt: invite.expires_at,
    } });
  }

  if (method === 'POST' && path === '/api/team/invitations/accept') {
    const body = await bodyJson(req);
    const rawToken = text(body.token, 'Convite', 200, true);
    const invite = db.prepare(`SELECT ti.* FROM team_invitations ti JOIN users u ON u.id = ti.user_id
      WHERE ti.token_hash = ? AND ti.accepted_at IS NULL AND ti.expires_at > ? AND u.active = 0`)
      .get(tokenHash(rawToken), nowIso());
    if (!invite) fail(404, 'Convite inválido ou expirado.');
    let passwordHash;
    try { passwordHash = hashPassword(body.password); }
    catch (error) { fail(422, error.message); }
    transaction(db, () => {
      const claimed = db.prepare(`UPDATE team_invitations SET accepted_at = ? WHERE id = ?
        AND accepted_at IS NULL AND expires_at > ?`).run(nowIso(), invite.id, nowIso());
      if (claimed.changes !== 1) fail(404, 'Convite inválido ou expirado.');
      const activated = db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE id = ? AND active = 0')
        .run(passwordHash, invite.user_id);
      if (activated.changes !== 1) fail(404, 'Convite inválido ou expirado.');
      audit(db, invite.user_id, 'team_invitation', invite.id, 'accepted');
    });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(invite.user_id);
    const token = createSession(db, user.id);
    return json(res, 200, { user: userDto(db, user) }, { 'Set-Cookie': sessionCookie(token, req) });
  }

  if (method === 'GET' && path === '/api/auth/reset/preview') {
    const token = url.searchParams.get('token');
    if (!token || token.length > 200) fail(404, 'Link inválido ou expirado.');
    const reset = db.prepare(`SELECT u.email FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.active = 1`)
      .get(tokenHash(token), nowIso());
    if (!reset) fail(404, 'Link inválido ou expirado.');
    return json(res, 200, { email: reset.email });
  }

  if (method === 'POST' && path === '/api/auth/reset') {
    const body = await bodyJson(req);
    const token = text(body.token, 'Link', 200, true);
    const reset = db.prepare(`SELECT r.* FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.active = 1`)
      .get(tokenHash(token), nowIso());
    if (!reset) fail(404, 'Link inválido ou expirado.');
    let passwordHash;
    try { passwordHash = hashPassword(body.password); }
    catch (error) { fail(422, error.message); }
    transaction(db, () => {
      const claimed = db.prepare(`UPDATE password_resets SET used_at = ? WHERE token_hash = ?
        AND used_at IS NULL AND expires_at > ?`).run(nowIso(), tokenHash(token), nowIso());
      if (claimed.changes !== 1) fail(404, 'Link inválido ou expirado.');
      const changed = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND active = 1')
        .run(passwordHash, reset.user_id);
      if (changed.changes !== 1) fail(404, 'Link inválido ou expirado.');
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .run(nowIso(), reset.user_id);
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(nowIso(), reset.user_id);
      audit(db, reset.user_id, 'user', reset.user_id, 'password_reset');
    });
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  const user = requireUser(db, req);
  if (method === 'GET' && path === '/api/me') return json(res, 200, { user: userDto(db, user) });

  if (method === 'GET' && path === '/api/clients') {
    requirePermission(db, user, 'clients');
    const q = text(url.searchParams.get('q'), 'Busca', 100);
    const clauses = [];
    const args = [];
    if (user.role === 'team') {
      clauses.push(`(c.created_by = ? OR EXISTS (
        SELECT 1 FROM event_clients ec JOIN event_team et ON et.event_id = ec.event_id
        WHERE ec.client_id = c.id AND et.user_id = ?))`);
      args.push(user.id, user.id);
    }
    if (q) {
      clauses.push('(c.name LIKE ? OR c.email LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const clients = db.prepare(`SELECT c.* FROM clients c
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY c.name`).all(...args);
    return json(res, 200, { clients: clients.map(clientDto) });
  }

  if (method === 'POST' && path === '/api/clients') {
    requirePermission(db, user, 'clients', 'edit');
    const body = await bodyJson(req);
    const client = {
      id: randomUUID(), name: text(body.name, 'Nome', 150, true),
      email: email(body.email), phone: text(body.phone, 'Telefone', 40),
    };
    const timestamp = nowIso();
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'clients', 'edit');
      if (db.prepare('SELECT 1 FROM clients WHERE email = ?').get(client.email)) {
        fail(409, 'Já existe um cliente com esse e-mail.');
      }
      db.prepare(`INSERT INTO clients
        (id, name, email, phone, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(client.id, client.name, client.email, client.phone, timestamp, timestamp, current.id);
      audit(db, current.id, 'client', client.id, 'created');
    });
    return json(res, 201, { client: clientDto(db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id)) });
  }

  const clientMatch = path.match(/^\/api\/clients\/([^/]+)$/);
  if (clientMatch && method === 'PATCH') {
    requirePermission(db, user, 'clients', 'edit');
    const body = await bodyJson(req);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'clients', 'edit');
      const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientMatch[1]);
      if (!existing || (current.role === 'team' && !teamCanUseClient(db, current, existing.id))) {
        fail(404, 'Cliente não encontrado.');
      }
      const name = Object.hasOwn(body, 'name') ? text(body.name, 'Nome', 150, true) : existing.name;
      const address = Object.hasOwn(body, 'email') ? email(body.email) : existing.email;
      const phone = Object.hasOwn(body, 'phone') ? text(body.phone, 'Telefone', 40) : existing.phone;
      const emailChanged = address !== existing.email.toLowerCase();
      if (emailChanged && db.prepare('SELECT 1 FROM users WHERE client_id = ? AND active = 1').get(existing.id)) {
        fail(409, 'O e-mail de uma conta ativada não pode ser alterado por este formulário.');
      }
      if (emailChanged && db.prepare('SELECT 1 FROM clients WHERE email = ? AND id != ?').get(address, existing.id)) {
        fail(409, 'Já existe um cliente com esse e-mail.');
      }
      if (emailChanged) db.prepare(`UPDATE invitations SET expires_at = ?
        WHERE client_id = ? AND accepted_at IS NULL`).run(nowIso(), existing.id);
      db.prepare('UPDATE clients SET name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?')
        .run(name, address, phone, nowIso(), existing.id);
      audit(db, current.id, 'client', existing.id, 'updated', { fields: Object.keys(body) });
    });
    return json(res, 200, { client: clientDto(db.prepare('SELECT * FROM clients WHERE id = ?').get(clientMatch[1])) });
  }

  if (method === 'GET' && path === '/api/events') {
    requirePermission(db, user, 'events');
    const status = url.searchParams.get('status');
    if (status && !statuses.includes(status)) fail(422, 'Situação inválida.');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) fail(422, 'Data inicial inválida.');
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail(422, 'Data final inválida.');
    const rows = eventList(db, {
      status, clientId: url.searchParams.get('clientId'),
      responsibleUserId: url.searchParams.get('responsibleUserId'),
      from, to: to ? `${to}T23:59:59.999Z` : null,
      q: text(url.searchParams.get('q'), 'Busca', 100),
    }, user);
    return json(res, 200, { events: rows.map((row) => eventDto(db, row)) });
  }

  if (method === 'POST' && path === '/api/events') {
    requirePermission(db, user, 'events', 'edit');
    const body = await bodyJson(req);
    const id = randomUUID();
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'events', 'edit');
      const prepared = current.role === 'team'
        ? { ...body, teamUserIds: [current.id], responsibleUserId: current.id } : body;
      const data = eventInput(db, prepared);
      requireUsableClients(db, current, data.clientIds);
      const code = `EVT-${new Date(data.startAt).getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
      const timestamp = nowIso();
      db.prepare(`INSERT INTO events
        (id, code, name, type, status, start_at, end_at, timezone, guest_estimated, guest_confirmed,
         ceremony_name, reception_name, ceremony_address, reception_address, ceremony_map_url, reception_map_url,
         address_line, city, state, postal_code, map_url, internal_notes, responsible_user_id,
         created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, code, data.name, data.type, data.status, data.startAt, data.endAt, data.timezone,
          data.guestEstimated, data.guestConfirmed, data.ceremonyName, data.receptionName,
          data.ceremonyAddress, data.receptionAddress, data.ceremonyMapUrl, data.receptionMapUrl,
          data.addressLine, data.city, data.state, data.postalCode, data.mapUrl, data.internalNotes,
          data.responsibleUserId, current.id, timestamp, timestamp);
      saveEventLinks(db, id, data);
      audit(db, current.id, 'event', id, 'created');
    });
    return json(res, 201, { event: eventDto(db, getEvent(db, id)) });
  }

  const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && method === 'GET') {
    requirePermission(db, user, 'events');
    requireTeamEvent(db, user, eventMatch[1]);
    return json(res, 200, { event: eventDto(db, getEvent(db, eventMatch[1])) });
  }
  if (eventMatch && method === 'PATCH') {
    requirePermission(db, user, 'events', 'edit');
    requireTeamEvent(db, user, eventMatch[1]);
    const body = await bodyJson(req);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'events', 'edit');
      requireTeamEvent(db, current, eventMatch[1]);
      const existing = getEvent(db, eventMatch[1]);
      let prepared = body;
      if (current.role === 'team') {
        if (Object.hasOwn(body, 'teamUserIds') &&
            (!Array.isArray(body.teamUserIds) || !body.teamUserIds.includes(current.id))) {
          fail(422, 'Você não pode remover seu próprio acesso ao evento.');
        }
        if (Object.hasOwn(body, 'responsibleUserId') && body.responsibleUserId !== existing.responsible_user_id) {
          fail(403, 'Somente o proprietário pode alterar o responsável interno.');
        }
        prepared = {
          ...body,
          teamUserIds: eventTeam(db, existing.id).map((member) => member.id),
          responsibleUserId: existing.responsible_user_id,
        };
      }
      const data = eventInput(db, prepared, existing);
      requireUsableClients(db, current, data.clientIds);
      const previousClients = eventClients(db, existing.id).map((client) => client.id);
      db.prepare(`UPDATE events SET name = ?, type = ?, status = ?, start_at = ?, end_at = ?, timezone = ?,
        guest_estimated = ?, guest_confirmed = ?, ceremony_name = ?, reception_name = ?,
        ceremony_address = ?, reception_address = ?, ceremony_map_url = ?, reception_map_url = ?,
        address_line = ?, city = ?, state = ?, postal_code = ?, map_url = ?, internal_notes = ?,
        responsible_user_id = ?, updated_at = ? WHERE id = ?`)
        .run(data.name, data.type, data.status, data.startAt, data.endAt, data.timezone,
          data.guestEstimated, data.guestConfirmed, data.ceremonyName, data.receptionName,
          data.ceremonyAddress, data.receptionAddress, data.ceremonyMapUrl, data.receptionMapUrl,
          data.addressLine, data.city, data.state, data.postalCode, data.mapUrl, data.internalNotes,
          data.responsibleUserId, nowIso(), existing.id);
      saveEventLinks(db, existing.id, data);
      for (const clientId of previousClients) {
        if (!data.clientIds.includes(clientId)) {
          db.prepare(`UPDATE invitations SET expires_at = ?
            WHERE event_id = ? AND client_id = ? AND accepted_at IS NULL`)
            .run(nowIso(), existing.id, clientId);
        }
      }
      audit(db, current.id, 'event', existing.id, 'updated', { fields: Object.keys(body) });
    });
    return json(res, 200, { event: eventDto(db, getEvent(db, eventMatch[1])) });
  }

  const invitationMatch = path.match(/^\/api\/events\/([^/]+)\/invitations$/);
  if (invitationMatch && method === 'POST') {
    requirePermission(db, user, 'events', 'edit');
    requireTeamEvent(db, user, invitationMatch[1]);
    const body = await bodyJson(req);
    const clientId = text(body.clientId, 'Cliente', 100, true);
    const expiresDays = body.expiresDays === undefined ? 7 : body.expiresDays;
    if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 90) {
      fail(422, 'O convite deve expirar entre 1 e 90 dias.');
    }
    const token = newToken();
    const expiresAt = new Date(Date.now() + expiresDays * 86400_000).toISOString();
    const id = randomUUID();
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'events', 'edit');
      requireTeamEvent(db, current, invitationMatch[1]);
      getEvent(db, invitationMatch[1]);
      const linked = db.prepare('SELECT 1 FROM event_clients WHERE event_id = ? AND client_id = ?')
        .get(invitationMatch[1], clientId);
      if (!linked) fail(422, 'Vincule o cliente ao evento antes de convidá-lo.');
      db.prepare(`UPDATE invitations SET expires_at = ?
        WHERE event_id = ? AND client_id = ? AND accepted_at IS NULL`)
        .run(nowIso(), invitationMatch[1], clientId);
      db.prepare(`INSERT INTO invitations
        (id, event_id, client_id, token_hash, expires_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, invitationMatch[1], clientId, tokenHash(token), expiresAt, current.id, nowIso());
      audit(db, current.id, 'invitation', id, 'created', { eventId: invitationMatch[1], clientId });
    });
    const inviteUrl = `${publicBaseUrl(req)}/convite?token=${encodeURIComponent(token)}`;
    return json(res, 201, { inviteUrl, expiresAt });
  }

  if (method === 'GET' && path === '/api/dashboard') {
    requirePermission(db, user, 'dashboard');
    const scope = eventScope(user);
    const byStatus = Object.fromEntries(statuses.map((status) => [status, 0]));
    for (const row of db.prepare(`SELECT e.status, COUNT(*) AS total FROM events e
      WHERE ${scope.sql} GROUP BY e.status`).all(...scope.args)) {
      byStatus[row.status] = row.total;
    }
    const total = db.prepare(`SELECT COUNT(*) AS total FROM events e WHERE ${scope.sql}`)
      .get(...scope.args).total;
    const now = nowIso();
    const mayViewEvents = can(db, user, 'events');
    const upcoming = mayViewEvents ? db.prepare(`SELECT e.* FROM events e WHERE ${scope.sql}
      AND e.start_at >= ? AND e.status != 'cancelado' ORDER BY e.start_at ASC LIMIT 8`)
      .all(...scope.args, now).map((row) => eventDto(db, row)) : [];
    const recent = mayViewEvents ? db.prepare(`SELECT e.* FROM events e WHERE ${scope.sql}
      ORDER BY e.created_at DESC LIMIT 5`).all(...scope.args).map((row) => eventDto(db, row)) : [];
    return json(res, 200, { total, byStatus, upcoming, recent });
  }

  if (method === 'GET' && path === '/api/calendar') {
    requirePermission(db, user, 'calendar');
    const month = url.searchParams.get('month');
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(422, 'Use month=AAAA-MM.');
    const requestedTimezone = url.searchParams.has('timezone')
      ? timezone(url.searchParams.get('timezone')) : null;
    const scope = eventScope(user);
    const events = db.prepare(`SELECT e.* FROM events e WHERE ${scope.sql} ORDER BY e.start_at ASC`)
      .all(...scope.args).filter((row) => monthKey(row.start_at, requestedTimezone || row.timezone) === month)
      .map((row) => can(db, user, 'events') ? eventDto(db, row) : calendarEventDto(row));
    return json(res, 200, { events });
  }

  if (method === 'GET' && path === '/api/portal/events') {
    if (user.role !== 'client' || !user.client_id) fail(403, 'Área exclusiva dos clientes.');
    const events = db.prepare(`SELECT e.* FROM events e JOIN event_clients ec ON ec.event_id = e.id
      WHERE ec.client_id = ? ORDER BY e.start_at ASC`).all(user.client_id)
      .map((row) => eventDto(db, row, true));
    return json(res, 200, { events });
  }

  const portalMatch = path.match(/^\/api\/portal\/events\/([^/]+)$/);
  if (portalMatch && method === 'GET') {
    if (!linkedClient(db, user, portalMatch[1])) fail(404, 'Evento não encontrado.');
    return json(res, 200, { event: eventDto(db, getEvent(db, portalMatch[1]), true) });
  }

  if (method === 'GET' && path === '/api/team') {
    requireOwner(user);
    const team = db.prepare("SELECT * FROM users WHERE role IN ('owner', 'team') ORDER BY name").all()
      .map((row) => ({ ...userDto(db, row), active: Boolean(row.active) }));
    return json(res, 200, { team });
  }

  if (method === 'GET' && path === '/api/admin/users') {
    requireOwner(user);
    const users = db.prepare('SELECT * FROM users ORDER BY name').all()
      .map((row) => ({ ...userDto(db, row), active: Boolean(row.active) }));
    return json(res, 200, { users });
  }

  if (method === 'POST' && (path === '/api/team' || path === '/api/admin/users')) {
    requireOwner(user);
    const body = await bodyJson(req);
    const name = text(body.name, 'Nome', 150, true);
    const address = email(body.email);
    const jobTitle = text(body.jobTitle, 'Função', 120);
    const id = randomUUID();
    const invitationId = randomUUID();
    const token = newToken();
    const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    const inputPermissions = body.permissions || {};
    if (typeof inputPermissions !== 'object' || Array.isArray(inputPermissions)) fail(422, 'Permissões inválidas.');
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requireOwner(current);
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(address)) fail(409, 'E-mail já utilizado.');
      db.prepare(`INSERT INTO users (id, name, email, job_title, password_hash, role, active, created_at)
        VALUES (?, ?, ?, ?, '', 'team', 0, ?)`).run(id, name, address, jobTitle, nowIso());
      setPermissions(db, id, inputPermissions);
      db.prepare(`INSERT INTO team_invitations
        (id, user_id, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(invitationId, id, tokenHash(token), expiresAt, current.id, nowIso());
      audit(db, current.id, 'user', id, 'team_created');
    });
    return json(res, 201, {
      inviteUrl: `${publicBaseUrl(req)}/convite-equipe?token=${encodeURIComponent(token)}`,
      expiresAt,
      user: userDto(db, db.prepare('SELECT * FROM users WHERE id = ?').get(id)),
    });
  }

  const teamReinviteMatch = path.match(/^\/api\/team\/([^/]+)\/invitations$/);
  if (teamReinviteMatch && method === 'POST') {
    requireOwner(user);
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'team' AND active = 0")
      .get(teamReinviteMatch[1]);
    if (!target) fail(404, 'Integrante pendente não encontrado.');
    const token = newToken();
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    transaction(db, () => {
      db.prepare('UPDATE team_invitations SET expires_at = ? WHERE user_id = ? AND accepted_at IS NULL')
        .run(nowIso(), target.id);
      db.prepare(`INSERT INTO team_invitations
        (id, user_id, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, target.id, tokenHash(token), expiresAt, user.id, nowIso());
      audit(db, user.id, 'team_invitation', id, 'resent', { userId: target.id });
    });
    return json(res, 201, {
      inviteUrl: `${publicBaseUrl(req)}/convite-equipe?token=${encodeURIComponent(token)}`,
      expiresAt, delivery: 'manual',
    });
  }

  const permissionMatch = path.match(/^\/api\/(?:team|admin\/users)\/([^/]+)\/permissions$/);
  if (permissionMatch && method === 'PATCH') {
    requireOwner(user);
    const body = await bodyJson(req);
    if (!body.permissions || typeof body.permissions !== 'object' || Array.isArray(body.permissions)) {
      fail(422, 'Permissões inválidas.');
    }
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requireOwner(current);
      const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'team'").get(permissionMatch[1]);
      if (!target) fail(404, 'Integrante da equipe não encontrado.');
      setPermissions(db, target.id, body.permissions);
      audit(db, current.id, 'user', target.id, 'permissions_updated');
    });
    return json(res, 200, { user: userDto(db, db.prepare('SELECT * FROM users WHERE id = ?').get(permissionMatch[1])) });
  }

  const resetLinkMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-link$/);
  if (resetLinkMatch && method === 'POST') {
    requireOwner(user);
    const target = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(resetLinkMatch[1]);
    if (!target) fail(404, 'Usuário não encontrado.');
    const token = newToken();
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    transaction(db, () => {
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .run(nowIso(), target.id);
      db.prepare(`INSERT INTO password_resets
        (token_hash, user_id, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(tokenHash(token), target.id, expiresAt, user.id, nowIso());
      audit(db, user.id, 'user', target.id, 'reset_link_created');
    });
    return json(res, 201, {
      resetUrl: `${publicBaseUrl(req)}/recuperar?token=${encodeURIComponent(token)}`,
      expiresAt,
      delivery: 'manual',
    });
  }

  fail(404, 'Rota não encontrada.');
}

function setPermissions(db, userId, permissions) {
  for (const module of modules) {
    const value = permissions[module] || {};
    if (typeof value !== 'object' || Array.isArray(value)) fail(422, `Permissão de ${module} inválida.`);
    const read = value.read === true || value.write === true;
    const write = value.write === true;
    db.prepare(`INSERT INTO team_permissions (user_id, module, can_view, can_edit)
      VALUES (?, ?, ?, ?) ON CONFLICT(user_id, module)
      DO UPDATE SET can_view = excluded.can_view, can_edit = excluded.can_edit`)
      .run(userId, module, Number(read), Number(write));
  }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(res, pathname, publicDir) {
  let requested;
  try { requested = decodeURIComponent(pathname); }
  catch { fail(400, 'Caminho inválido.'); }
  if (requested.includes('\0') || requested.includes('\\')) fail(400, 'Caminho inválido.');
  const root = resolve(publicDir);
  const candidate = resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) fail(403, 'Acesso negado.');
  let file = candidate;
  try {
    if (!(await stat(file)).isFile()) fail(404, 'Arquivo não encontrado.');
  } catch {
    if (extname(requested)) fail(404, 'Arquivo não encontrado.');
    file = resolve(root, 'index.html');
  }
  let content;
  try { content = await readFile(file); }
  catch { fail(404, 'Interface não encontrada.'); }
  if (requested === '/manifest.webmanifest') {
    const manifest = JSON.parse(content.toString('utf8'));
    const { brandName } = publicConfig();
    manifest.name = `${brandName} — Eventos e celebrações`;
    manifest.short_name = brandName;
    content = Buffer.from(JSON.stringify(manifest));
  }
  res.writeHead(200, {
    'Content-Type': mimeTypes[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': requested === '/manifest.webmanifest' || file.endsWith('service-worker.js') || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(content);
}

export function createApp({ dbPath, publicDir = resolve(import.meta.dirname, '..', 'public') } = {}) {
  const db = openDatabase(dbPath);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) await handleApi(db, req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(res, url.pathname, publicDir);
      else fail(405, 'Método não permitido.');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof ApiError) json(res, error.status, { error: error.message });
      else {
        console.error('Erro interno:', error);
        json(res, 500, { error: 'Erro interno. Tente novamente.' });
      }
    }
  });
  return { server, db };
}
