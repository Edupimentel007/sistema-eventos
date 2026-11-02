import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { transaction } from './db.js';

const MAX_JSON_BYTES = 17_500_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MIME = {
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], magic: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { extensions: ['.png'], magic: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/webp': { extensions: ['.webp'], magic: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'application/pdf': { extensions: ['.pdf'], magic: b => b.subarray(0, 5).toString() === '%PDF-' },
};

async function mediaBody(req, fail) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'Envie o arquivo em JSON.');
  if (Number(req.headers['content-length'] || 0) > MAX_JSON_BYTES) fail(413, 'O envio excede o limite permitido.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) fail(413, 'O envio excede o limite permitido.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'JSON inválido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'JSON inválido.');
  return body;
}

function string(value, label, max, required, fail) {
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

function uploadFile(body, kind, fail) {
  const original = string(body.filename, 'Nome do arquivo', 180, true, fail)
    .replaceAll('\\', '/').split('/').pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!original || original.length > 150) fail(422, 'Nome do arquivo inválido.');
  const mimeType = string(body.mimeType, 'Tipo do arquivo', 100, true, fail).toLowerCase();
  const allowed = kind === 'contract' ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp'];
  const definition = MIME[mimeType];
  const extension = original.slice(original.lastIndexOf('.')).toLowerCase();
  if (!definition || !allowed.includes(mimeType) || !definition.extensions.includes(extension)) {
    fail(415, kind === 'contract' ? 'Envie um PDF válido.' : 'Envie uma imagem JPG, PNG ou WebP.');
  }
  const base64 = string(body.contentBase64, 'Conteúdo do arquivo', 17_000_000, true, fail);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail(422, 'Arquivo codificado inválido.');
  const bytes = Buffer.from(base64, 'base64');
  const max = kind === 'contract' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (bytes.length < 8 || bytes.length > max || bytes.toString('base64') !== base64 || !definition.magic(bytes)) {
    fail(422, 'Arquivo inválido ou acima do limite permitido.');
  }
  return { originalName: original, mimeType, bytes,
    storageName: `${randomUUID()}${extension}`,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

function eventScope(db, user, eventId, action, requirePermission, linkedClient, fail) {
  if (user.role === 'client') {
    if (action === 'contract-edit' || !linkedClient(db, user, eventId)) fail(404, 'Evento não encontrado.');
    return;
  }
  requirePermission(db, user, 'events', action === 'edit' || action === 'contract-edit' ? 'edit' : 'view');
  const exists = db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId);
  if (!exists || (user.role === 'team' && !db.prepare(
    'SELECT 1 FROM event_team WHERE event_id = ? AND user_id = ?').get(eventId, user.id))) {
    fail(404, 'Evento não encontrado.');
  }
}

function clientInEvent(db, eventId, clientId, fail) {
  if (!clientId || !db.prepare('SELECT 1 FROM event_clients WHERE event_id = ? AND client_id = ?')
    .get(eventId, clientId)) fail(422, 'Selecione um cliente vinculado ao evento.');
}

function inspirationDto(row) {
  return {
    id: row.id, eventId: row.event_id, title: row.title, note: row.note,
    visibility: row.visibility, clientId: row.client_id, uploaderName: row.uploader_name || '',
    filename: row.original_name, mimeType: row.mime_type, size: row.byte_size,
    createdAt: row.created_at, downloadUrl: `/api/media/files/${row.id}`,
  };
}

function contractDto(row) {
  return {
    id: row.id, eventId: row.event_id, clientId: row.client_id, clientName: row.client_name,
    title: row.title, version: row.version, signatureStatus: row.signature_status,
    sharedWithClient: Boolean(row.shared_with_client), filename: row.original_name,
    size: row.byte_size, mimeType: row.mime_type, createdAt: row.created_at,
    updatedAt: row.updated_at, downloadUrl: `/api/media/files/${row.id}`,
  };
}

function listInspirations(db, user, eventId) {
  const clauses = ['f.event_id = ?']; const args = [eventId];
  if (user.role === 'client') {
    clauses.push("(i.visibility = 'event' OR (i.visibility = 'client' AND i.client_id = ?))");
    args.push(user.client_id);
  }
  return db.prepare(`SELECT f.*, i.title, i.note, i.visibility, i.client_id,
    u.name AS uploader_name FROM event_inspirations i
    JOIN media_files f ON f.id = i.file_id LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE ${clauses.join(' AND ')} ORDER BY f.created_at DESC, f.id DESC`).all(...args).map(inspirationDto);
}

function listContracts(db, user, eventId) {
  const clauses = ['f.event_id = ?']; const args = [eventId];
  if (user.role === 'client') { clauses.push('c.client_id = ? AND c.shared_with_client = 1'); args.push(user.client_id); }
  return db.prepare(`SELECT f.*, c.client_id, c.title, c.version, c.signature_status,
    c.shared_with_client, c.updated_at, cl.name AS client_name FROM event_contracts c
    JOIN media_files f ON f.id = c.file_id JOIN clients cl ON cl.id = c.client_id
    WHERE ${clauses.join(' AND ')} ORDER BY f.created_at DESC, c.version DESC`).all(...args).map(contractDto);
}

function fileRow(db, id) {
  return db.prepare(`SELECT f.*, i.visibility, i.client_id AS inspiration_client_id,
    c.client_id AS contract_client_id, c.shared_with_client FROM media_files f
    LEFT JOIN event_inspirations i ON i.file_id = f.id
    LEFT JOIN event_contracts c ON c.file_id = f.id WHERE f.id = ?`).get(id);
}

function canReadFile(db, user, row, requirePermission, linkedClient, fail) {
  eventScope(db, user, row.event_id, 'view', requirePermission, linkedClient, fail);
  if (user.role !== 'client') return;
  if (row.kind === 'inspiration') {
    if (row.visibility === 'event' || (row.visibility === 'client' && row.inspiration_client_id === user.client_id)) return;
  } else if (row.kind === 'contract' && row.contract_client_id === user.client_id && row.shared_with_client === 1) return;
  fail(404, 'Arquivo não encontrado.');
}

async function saveUpload({ db, req, user, body, kind, eventId, mediaRoot, fail,
  requirePermission, requireCurrentUser, linkedClient, audit }) {
  const prepared = uploadFile(body, kind, fail);
  const root = resolve(mediaRoot || process.env.MEDIA_ROOT || 'data/uploads');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = resolve(root, prepared.storageName);
  if (!path.startsWith(root + sep)) fail(500, 'Destino do arquivo inválido.');
  await writeFile(path, prepared.bytes, { flag: 'wx', mode: 0o600 });
  const id = randomUUID(); const timestamp = new Date().toISOString();
  try {
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      eventScope(db, current, eventId, kind === 'contract' ? 'contract-edit' : 'edit',
        requirePermission, linkedClient, fail);
      db.prepare(`INSERT INTO media_files
        (id, event_id, uploaded_by, kind, storage_name, original_name, mime_type,
         byte_size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, eventId, current.id, kind, prepared.storageName, prepared.originalName,
          prepared.mimeType, prepared.bytes.length, prepared.sha256, timestamp);
      if (kind === 'inspiration') {
        const visibility = body.visibility || 'event';
        if (!['event', 'client', 'internal'].includes(visibility) ||
            (current.role === 'client' && visibility === 'internal')) fail(422, 'Visibilidade inválida.');
        let clientId = null;
        if (current.role === 'client') clientId = current.client_id;
        else if (visibility === 'client') {
          clientId = string(body.clientId, 'Cliente', 100, true, fail);
          clientInEvent(db, eventId, clientId, fail);
        }
        db.prepare(`INSERT INTO event_inspirations
          (file_id, title, note, visibility, client_id) VALUES (?, ?, ?, ?, ?)`)
          .run(id, string(body.title, 'Título', 160, false, fail),
            string(body.note, 'Comentário', 2000, false, fail), visibility, clientId);
      } else {
        const clientId = string(body.clientId, 'Cliente', 100, true, fail);
        clientInEvent(db, eventId, clientId, fail);
        const title = string(body.title, 'Título', 160, true, fail);
        const signature = body.signatureStatus || 'pending';
        if (!['pending', 'signed_manual'].includes(signature)) fail(422, 'Estado da assinatura inválido.');
        if (typeof body.sharedWithClient !== 'boolean') fail(422, 'Indique se o contrato será compartilhado.');
        const next = db.prepare(`SELECT COALESCE(MAX(c.version), 0) + 1 AS version
          FROM event_contracts c JOIN media_files f ON f.id = c.file_id
          WHERE f.event_id = ? AND c.client_id = ?`).get(eventId, clientId).version;
        db.prepare(`INSERT INTO event_contracts
          (file_id, client_id, title, version, signature_status, shared_with_client, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, clientId, title, next, signature, body.sharedWithClient ? 1 : 0, timestamp);
      }
      audit(db, current.id, kind, id, 'uploaded', { eventId, filename: prepared.originalName });
    });
  } catch (error) { await unlink(path).catch(() => {}); throw error; }
  return id;
}

export async function handleMediaApi({ db, req, res, url, user, json, fail,
  requirePermission, requireCurrentUser, linkedClient, audit, mediaRoot }) {
  const path = url.pathname; const method = req.method || 'GET';
  if (!path.startsWith('/api/media/')) return false;

  const fileMatch = path.match(/^\/api\/media\/files\/([^/]+)$/);
  if (fileMatch && method === 'GET') {
    const row = fileRow(db, fileMatch[1]);
    if (!row) fail(404, 'Arquivo não encontrado.');
    canReadFile(db, user, row, requirePermission, linkedClient, fail);
    const root = resolve(mediaRoot || process.env.MEDIA_ROOT || 'data/uploads');
    const full = resolve(root, row.storage_name);
    if (!/^[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp|pdf)$/.test(row.storage_name) ||
        !full.startsWith(root + sep)) fail(404, 'Arquivo não encontrado.');
    let bytes;
    try { bytes = await readFile(full); } catch { fail(404, 'Arquivo não encontrado.'); }
    res.writeHead(200, { 'Content-Type': row.mime_type, 'Content-Length': bytes.length,
      'Content-Disposition': `${row.kind === 'inspiration' ? 'inline' : 'attachment'}; filename="arquivo${row.storage_name.slice(row.storage_name.lastIndexOf('.'))}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes); return true;
  }

  const inspirationsMatch = path.match(/^\/api\/media\/events\/([^/]+)\/inspirations$/);
  if (inspirationsMatch) {
    const eventId = inspirationsMatch[1];
    eventScope(db, user, eventId, method === 'POST' ? 'edit' : 'view',
      requirePermission, linkedClient, fail);
    if (method === 'GET') return json(res, 200, { inspirations: listInspirations(db, user, eventId) });
    if (method === 'POST') {
      const body = await mediaBody(req, fail);
      const id = await saveUpload({ db, req, user, body, kind: 'inspiration', eventId,
        mediaRoot, fail, requirePermission, requireCurrentUser, linkedClient, audit });
      const inspiration = listInspirations(db, user, eventId).find(item => item.id === id);
      return json(res, 201, { inspiration });
    }
    fail(405, 'Método não permitido.');
  }

  const contractsMatch = path.match(/^\/api\/media\/events\/([^/]+)\/contracts$/);
  if (contractsMatch) {
    const eventId = contractsMatch[1];
    eventScope(db, user, eventId, method === 'POST' ? 'contract-edit' : 'view',
      requirePermission, linkedClient, fail);
    if (method === 'GET') return json(res, 200, { contracts: listContracts(db, user, eventId) });
    if (method === 'POST') {
      const body = await mediaBody(req, fail);
      const id = await saveUpload({ db, req, user, body, kind: 'contract', eventId,
        mediaRoot, fail, requirePermission, requireCurrentUser, linkedClient, audit });
      const contract = listContracts(db, user, eventId).find(item => item.id === id);
      return json(res, 201, { contract });
    }
    fail(405, 'Método não permitido.');
  }

  const contractMatch = path.match(/^\/api\/media\/contracts\/([^/]+)$/);
  if (contractMatch && method === 'PATCH') {
    const body = await mediaBody(req, fail);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      const old = fileRow(db, contractMatch[1]);
      if (!old || old.kind !== 'contract') fail(404, 'Contrato não encontrado.');
      eventScope(db, current, old.event_id, 'contract-edit', requirePermission, linkedClient, fail);
      const existing = db.prepare('SELECT * FROM event_contracts WHERE file_id = ?').get(old.id);
      const title = Object.hasOwn(body, 'title') ? string(body.title, 'Título', 160, true, fail) : existing.title;
      const signature = body.signatureStatus ?? existing.signature_status;
      if (!['pending', 'signed_manual'].includes(signature)) fail(422, 'Estado da assinatura inválido.');
      const shared = body.sharedWithClient ?? Boolean(existing.shared_with_client);
      if (typeof shared !== 'boolean') fail(422, 'Compartilhamento inválido.');
      db.prepare(`UPDATE event_contracts SET title = ?, signature_status = ?,
        shared_with_client = ?, updated_at = ? WHERE file_id = ?`)
        .run(title, signature, shared ? 1 : 0, new Date().toISOString(), old.id);
      audit(db, current.id, 'contract', old.id, 'updated', { sharedWithClient: shared, signatureStatus: signature });
    });
    const row = db.prepare(`SELECT f.*, c.client_id, c.title, c.version, c.signature_status,
      c.shared_with_client, c.updated_at, cl.name AS client_name FROM event_contracts c
      JOIN media_files f ON f.id = c.file_id JOIN clients cl ON cl.id = c.client_id
      WHERE f.id = ?`).get(contractMatch[1]);
    return json(res, 200, { contract: contractDto(row) });
  }

  fail(404, 'Rota de arquivos não encontrada.');
}
