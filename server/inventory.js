import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { transaction } from './db.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const now = () => new Date().toISOString();
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function valueText(value, label, max, fail, required = false) {
  if (value === undefined || value === null) {
    if (required) fail(422, `${label} é obrigatório.`);
    return '';
  }
  if (typeof value !== 'string') fail(422, `${label} deve ser texto.`);
  const text = value.trim();
  if (required && !text) fail(422, `${label} é obrigatório.`);
  if (text.length > max) fail(422, `${label} excede ${max} caracteres.`);
  return text;
}

function count(value, label, fail, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000) {
    fail(422, `${label} deve ser um número inteiro entre ${minimum} e 1.000.000.`);
  }
  return value;
}

function bool(value, label, fail) {
  if (typeof value !== 'boolean') fail(422, `${label} deve ser verdadeiro ou falso.`);
  return value;
}

function iso(value, label, fail) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    fail(422, `${label} precisa incluir data, hora e fuso.`);
  }
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) fail(422, `${label} inválido.`);
  return stamp.toISOString();
}

function email(value, fail) {
  const text = valueText(value, 'E-mail', 254, fail);
  if (text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) fail(422, 'E-mail inválido.');
  return text.toLowerCase();
}

function httpsUrl(value, fail) {
  const text = valueText(value, 'Site', 2048, fail);
  if (!text) return '';
  try { if (new URL(text).protocol !== 'https:') fail(422, 'O site deve usar HTTPS.'); }
  catch (error) { if (error.status) throw error; fail(422, 'Site inválido.'); }
  return text;
}

function supplierRow(db, id, fail) {
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!row) fail(404, 'Fornecedor não encontrado.');
  return row;
}

function supplierDto(db, row) {
  const offerings = db.prepare(`SELECT id, name, category, unit, notes
    FROM supplier_offerings WHERE supplier_id = ? ORDER BY position`).all(row.id);
  return {
    id: row.id, name: row.name, category: row.category, contactName: row.contact_name,
    email: row.email, phone: row.phone, website: row.website, notes: row.notes,
    active: Boolean(row.active), offerings, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function validateOfferings(value, fail) {
  if (!Array.isArray(value) || value.length > 50) fail(422, 'Informe até 50 produtos ou serviços.');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(422, 'Oferta inválida.');
    return { name: valueText(item.name, 'Nome da oferta', 160, fail, true),
      category: valueText(item.category, 'Categoria da oferta', 80, fail),
      unit: valueText(item.unit, 'Unidade da oferta', 40, fail),
      notes: valueText(item.notes, 'Observações da oferta', 1000, fail) };
  });
}

function saveOfferings(db, supplierId, offerings) {
  db.prepare('DELETE FROM supplier_offerings WHERE supplier_id = ?').run(supplierId);
  const insert = db.prepare(`INSERT INTO supplier_offerings
    (id, supplier_id, name, category, unit, notes, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  offerings.forEach((item, index) => insert.run(randomUUID(), supplierId, item.name,
    item.category, item.unit, item.notes, index + 1));
}

function requireEvent(db, user, eventId, fail) {
  const event = db.prepare('SELECT id, code, name, start_at, end_at, timezone FROM events WHERE id = ?').get(eventId);
  if (!event || (user.role === 'team' && !db.prepare(`SELECT 1 FROM event_team
    WHERE event_id = ? AND user_id = ?`).get(eventId, user.id))) {
    fail(404, 'Evento não encontrado.');
  }
  return event;
}

function itemRow(db, id, fail) {
  const row = db.prepare(`SELECT i.*, s.name AS supplier_name FROM inventory_items i
    LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ?`).get(id);
  if (!row) fail(404, 'Item não encontrado.');
  return row;
}

function photoDir(db) {
  const file = db.prepare('PRAGMA database_list').all().find((entry) => entry.name === 'main')?.file;
  const root = process.env.PRIVATE_UPLOAD_DIR || join(dirname(file || resolve('data/events.sqlite')),
    'private_uploads');
  const directory = resolve(root, 'inventory');
  const publicDir = resolve(import.meta.dirname, '..', 'public');
  if (directory === publicDir || directory.startsWith(publicDir + sep)) {
    throw new Error('PRIVATE_UPLOAD_DIR precisa ficar fora de public/.');
  }
  return directory;
}

function validImage(mime, data) {
  if (mime === 'image/jpeg') return data.length >= 100 && data[0] === 0xff &&
    data[1] === 0xd8 && data[2] === 0xff && data.at(-2) === 0xff && data.at(-1) === 0xd9;
  if (mime === 'image/png') return data.length >= 45 &&
    data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    data.readUInt32BE(8) === 13 && data.toString('ascii', 12, 16) === 'IHDR' &&
    data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0 &&
    data.readUInt32BE(16) <= 20000 && data.readUInt32BE(20) <= 20000 &&
    data.subarray(-8, -4).toString('ascii') === 'IEND';
  if (mime === 'image/webp') return data.length >= 30 &&
    data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' &&
    data.readUInt32LE(4) + 8 <= data.length &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(data.toString('ascii', 12, 16));
  return false;
}

function photosDto(db, itemId) {
  return db.prepare(`SELECT id, original_name, mime_type, size_bytes, created_at
    FROM inventory_item_photos WHERE item_id = ? AND archived_at IS NULL ORDER BY created_at DESC`)
    .all(itemId).map((row) => ({ id: row.id, originalName: row.original_name,
      mimeType: row.mime_type, sizeBytes: row.size_bytes, createdAt: row.created_at,
      url: `/api/inventory/items/${encodeURIComponent(itemId)}/photos/${encodeURIComponent(row.id)}` }));
}

function reservedAt(db, itemId, stamp) {
  return db.prepare(`SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory_reservations
    WHERE item_id = ? AND status = 'reserved' AND starts_at <= ? AND ends_at > ?`)
    .get(itemId, stamp, stamp).quantity;
}

function itemDto(db, row) {
  const reservedNow = reservedAt(db, row.id, now());
  return { id: row.id, name: row.name, category: row.category, ownership: row.ownership,
    unit: row.unit, dimensions: row.dimensions, description: row.description,
    supplierId: row.supplier_id, supplierName: row.supplier_name,
    stockQty: row.stock_quantity, reservedNowQty: reservedNow,
    availableNowQty: Math.max(0, row.stock_quantity - reservedNow),
    active: Boolean(row.active), photos: photosDto(db, row.id),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function reservationDto(db, row) {
  const item = db.prepare('SELECT name, unit FROM inventory_items WHERE id = ?').get(row.item_id);
  const event = db.prepare('SELECT code, name FROM events WHERE id = ?').get(row.event_id);
  return { id: row.id, itemId: row.item_id, itemName: item?.name || '', itemUnit: item?.unit || '',
    eventId: row.event_id, eventName: event?.name || '', eventCode: event?.code || '',
    quantity: row.quantity, startAt: row.starts_at, endAt: row.ends_at, status: row.status,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}

function peakReserved(db, itemId, candidate = null) {
  // O saldo atual não precisa cobrir períodos já encerrados. Ao criar uma reserva,
  // somente intervalos que se cruzam com ela participam do cálculo do pico.
  const lowerBound = candidate?.starts_at || now();
  const upperBound = candidate?.ends_at || null;
  const reservations = db.prepare(`SELECT starts_at, ends_at, quantity FROM inventory_reservations
    WHERE item_id = ? AND status = 'reserved' AND ends_at > ?
      ${upperBound ? 'AND starts_at < ?' : ''}`)
    .all(itemId, lowerBound, ...(upperBound ? [upperBound] : []));
  if (candidate) reservations.push(candidate);
  const points = reservations.flatMap((row) => [
    { time: row.starts_at, delta: row.quantity }, { time: row.ends_at, delta: -row.quantity },
  ]).sort((a, b) => a.time.localeCompare(b.time) || a.delta - b.delta);
  let current = 0; let peak = 0;
  for (const point of points) { current += point.delta; peak = Math.max(peak, current); }
  return peak;
}

function validSupplierId(db, value, fail) {
  if (value === null || value === '' || value === undefined) return null;
  const id = valueText(value, 'Fornecedor', 100, fail, true);
  const supplier = supplierRow(db, id, fail);
  if (!supplier.active) fail(422, 'Fornecedor inativo.');
  return id;
}

function validateSupplier(body, db, fail, old = null) {
  const field = (key, label, max, fallback = '') => own(body, key)
    ? valueText(body[key], label, max, fail, key === 'name') : old?.[key] ?? fallback;
  const data = {
    name: field('name', 'Nome', 160), category: field('category', 'Categoria', 80),
    contactName: field('contactName', 'Contato', 120),
    email: own(body, 'email') ? email(body.email, fail) : old?.email ?? '',
    phone: field('phone', 'Telefone', 40),
    website: own(body, 'website') ? httpsUrl(body.website, fail) : old?.website ?? '',
    notes: field('notes', 'Observações', 3000),
    active: own(body, 'active') ? bool(body.active, 'Situação', fail) : old?.active ?? true,
    offerings: own(body, 'offerings') ? validateOfferings(body.offerings, fail) : null,
  };
  if (!data.name) fail(422, 'Nome é obrigatório.');
  return data;
}

function validateItem(body, db, fail, old = null) {
  const field = (key, label, max, fallback = '') => own(body, key)
    ? valueText(body[key], label, max, fail, key === 'name' || key === 'category')
    : old?.[key] ?? fallback;
  const ownership = own(body, 'ownership') ? body.ownership : old?.ownership ?? 'own';
  if (!['own', 'rental'].includes(ownership)) fail(422, 'Origem do item inválida.');
  const active = own(body, 'active') ? bool(body.active, 'Situação', fail) : old?.active ?? true;
  const data = {
    name: field('name', 'Nome', 160), category: field('category', 'Categoria', 80),
    ownership, unit: field('unit', 'Unidade', 40, 'unidade') || 'unidade',
    dimensions: field('dimensions', 'Medidas', 120),
    description: field('description', 'Descrição', 3000),
    supplierId: own(body, 'supplierId') ? validSupplierId(db, body.supplierId, fail)
      : old?.supplierId ?? null,
    active,
  };
  if (!data.name || !data.category) fail(422, 'Nome e categoria são obrigatórios.');
  return data;
}

export async function handleInventoryApi({ db, req, res, url, user, json, bodyJson, fail,
  requirePermission, requireCurrentUser, audit }) {
  const path = url.pathname;
  const method = req.method || 'GET';

  if (path.startsWith('/api/suppliers')) {
    requirePermission(db, user, 'suppliers');
    if (path === '/api/suppliers' && method === 'GET') {
      const q = valueText(url.searchParams.get('q'), 'Busca', 100, fail).toLocaleLowerCase('pt-BR');
      const category = valueText(url.searchParams.get('category'), 'Categoria', 80, fail);
      const rows = db.prepare(`SELECT * FROM suppliers
        ${category ? 'WHERE category = ?' : ''} ORDER BY name COLLATE NOCASE`)
        .all(...(category ? [category] : []));
      const suppliers = rows.filter((row) => !q || [row.name, row.category, row.contact_name,
        row.email, row.phone, ...db.prepare(`SELECT name FROM supplier_offerings
        WHERE supplier_id = ?`).all(row.id).map((item) => item.name)]
        .join(' ').toLocaleLowerCase('pt-BR').includes(q)).map((row) => supplierDto(db, row));
      return json(res, 200, { suppliers });
    }
    if (path === '/api/suppliers' && method === 'POST') {
      requirePermission(db, user, 'suppliers', 'edit');
      const body = await bodyJson(req);
      const data = validateSupplier(body, db, fail);
      const id = transaction(db, () => {
        const current = requireCurrentUser(db, req, user);
        requirePermission(db, current, 'suppliers', 'edit');
        const id = randomUUID(); const timestamp = now();
        db.prepare(`INSERT INTO suppliers
          (id, name, category, contact_name, email, phone, website, notes, active,
           created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, data.name, data.category,
          data.contactName, data.email, data.phone, data.website, data.notes,
          data.active ? 1 : 0, current.id, timestamp, timestamp);
        saveOfferings(db, id, data.offerings || []);
        audit(db, current.id, 'supplier', id, 'created');
        return id;
      });
      return json(res, 201, { supplier: supplierDto(db, supplierRow(db, id, fail)) });
    }
    const match = path.match(/^\/api\/suppliers\/([^/]+)$/);
    if (match && method === 'GET') {
      return json(res, 200, { supplier: supplierDto(db, supplierRow(db, match[1], fail)) });
    }
    if (match && method === 'PATCH') {
      requirePermission(db, user, 'suppliers', 'edit');
      const body = await bodyJson(req);
      transaction(db, () => {
        const current = requireCurrentUser(db, req, user);
        requirePermission(db, current, 'suppliers', 'edit');
        const row = supplierRow(db, match[1], fail);
        const data = validateSupplier(body, db, fail, {
          name: row.name, category: row.category, contactName: row.contact_name,
          email: row.email, phone: row.phone, website: row.website, notes: row.notes,
          active: Boolean(row.active),
        });
        db.prepare(`UPDATE suppliers SET name=?, category=?, contact_name=?, email=?, phone=?,
          website=?, notes=?, active=?, updated_at=? WHERE id=?`)
          .run(data.name, data.category, data.contactName, data.email, data.phone,
            data.website, data.notes, data.active ? 1 : 0, now(), row.id);
        if (data.offerings) saveOfferings(db, row.id, data.offerings);
        audit(db, current.id, 'supplier', row.id, 'updated', { fields: Object.keys(body) });
      });
      return json(res, 200, { supplier: supplierDto(db, supplierRow(db, match[1], fail)) });
    }
    fail(404, 'Rota de fornecedores não encontrada.');
  }

  if (!path.startsWith('/api/inventory')) return false;
  requirePermission(db, user, 'inventory');

  if (path === '/api/inventory/events' && method === 'GET') {
    const rows = db.prepare(`SELECT e.id, e.code, e.name, e.start_at, e.end_at, e.timezone FROM events e
      ${user.role === 'team' ? `JOIN event_team et ON et.event_id = e.id AND et.user_id = ?` : ''}
      ORDER BY e.start_at DESC`).all(...(user.role === 'team' ? [user.id] : []));
    return json(res, 200, { events: rows.map((row) => ({ id: row.id, code: row.code,
      name: row.name, startAt: row.start_at, endAt: row.end_at,
      timezone: row.timezone })) });
  }

  if (path === '/api/inventory/suppliers' && method === 'GET') {
    const rows = db.prepare(`SELECT id, name, category FROM suppliers
      WHERE active = 1 ORDER BY name COLLATE NOCASE`).all();
    return json(res, 200, { suppliers: rows });
  }

  if (path === '/api/inventory/items' && method === 'GET') {
    const q = valueText(url.searchParams.get('q'), 'Busca', 100, fail).toLocaleLowerCase('pt-BR');
    const category = valueText(url.searchParams.get('category'), 'Categoria', 80, fail);
    const rows = db.prepare(`SELECT i.*, s.name AS supplier_name FROM inventory_items i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      ${category ? 'WHERE i.category = ?' : ''} ORDER BY i.name COLLATE NOCASE`)
      .all(...(category ? [category] : []));
    const items = rows.filter((row) => !q || [row.name, row.category, row.dimensions,
      row.description, row.supplier_name].join(' ').toLocaleLowerCase('pt-BR').includes(q))
      .map((row) => itemDto(db, row));
    return json(res, 200, { items });
  }

  if (path === '/api/inventory/items' && method === 'POST') {
    requirePermission(db, user, 'inventory', 'edit');
    const body = await bodyJson(req);
    const stockQty = count(body.stockQty ?? 0, 'Quantidade inicial', fail);
    const id = transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'inventory', 'edit');
      const data = validateItem(body, db, fail);
      const id = randomUUID(); const timestamp = now();
      db.prepare(`INSERT INTO inventory_items (id, name, category, ownership, unit,
        dimensions, description, supplier_id, stock_quantity, active, created_by,
        created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, data.name, data.category, data.ownership, data.unit, data.dimensions,
          data.description, data.supplierId, stockQty, data.active ? 1 : 0,
          current.id, timestamp, timestamp);
      if (stockQty > 0) db.prepare(`INSERT INTO inventory_movements
        (id, item_id, kind, quantity, reason, created_by, created_at)
        VALUES (?, ?, 'in', ?, 'Estoque inicial', ?, ?)`)
        .run(randomUUID(), id, stockQty, current.id, timestamp);
      audit(db, current.id, 'inventory_item', id, 'created', { stockQty });
      return id;
    });
    return json(res, 201, { item: itemDto(db, itemRow(db, id, fail)) });
  }

  const photoMatch = path.match(/^\/api\/inventory\/items\/([^/]+)\/photos\/([^/]+)$/);
  if (photoMatch && method === 'GET') {
    itemRow(db, photoMatch[1], fail);
    const row = db.prepare(`SELECT * FROM inventory_item_photos
      WHERE id = ? AND item_id = ? AND archived_at IS NULL`).get(photoMatch[2], photoMatch[1]);
    if (!row) fail(404, 'Foto não encontrada.');
    let contents;
    try { contents = readFileSync(join(photoDir(db), row.storage_name)); }
    catch { fail(404, 'Foto não encontrada.'); }
    res.writeHead(200, { 'Content-Type': row.mime_type, 'Content-Length': contents.length,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="foto-${row.id}"` });
    res.end(contents);
    return true;
  }
  if (photoMatch && method === 'DELETE') {
    requirePermission(db, user, 'inventory', 'edit');
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'inventory', 'edit');
      itemRow(db, photoMatch[1], fail);
      const row = db.prepare(`SELECT id FROM inventory_item_photos
        WHERE id = ? AND item_id = ? AND archived_at IS NULL`).get(photoMatch[2], photoMatch[1]);
      if (!row) fail(404, 'Foto não encontrada.');
      db.prepare('UPDATE inventory_item_photos SET archived_at = ? WHERE id = ?')
        .run(now(), row.id);
      audit(db, current.id, 'inventory_photo', row.id, 'archived', { itemId: photoMatch[1] });
    });
    return json(res, 200, { ok: true });
  }

  const photoCreate = path.match(/^\/api\/inventory\/items\/([^/]+)\/photos$/);
  if (photoCreate && method === 'POST') {
    requirePermission(db, user, 'inventory', 'edit');
    itemRow(db, photoCreate[1], fail);
    const mime = (req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime))
      fail(415, 'Use foto JPEG, PNG ou WebP.');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_PHOTO_BYTES) fail(413, 'Foto excede 8 MB.');
      chunks.push(chunk);
    }
    const contents = Buffer.concat(chunks);
    if (!validImage(mime, contents)) fail(422,
      'O conteúdo da foto não corresponde ao formato informado.');
    const suffix = mime === 'image/jpeg' ? '.jpg' : mime === 'image/png' ? '.png' : '.webp';
    let originalName = `foto${suffix}`;
    if (req.headers['x-file-name']) {
      try { originalName = decodeURIComponent(String(req.headers['x-file-name'])).split(/[\\/]/).pop(); }
      catch { fail(422, 'Nome do arquivo inválido.'); }
    }
    originalName = valueText(originalName, 'Nome da foto', 200, fail, true);
    if (/[\x00-\x1f\x7f]/.test(originalName)) fail(422, 'Nome da foto inválido.');
    const extension = extname(originalName).toLowerCase();
    if (!(extension === suffix || (mime === 'image/jpeg' && extension === '.jpeg')))
      fail(422, 'A extensão da foto não corresponde ao formato informado.');
    const id = randomUUID();
    const storageName = `${id}${suffix}`; const directory = photoDir(db);
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, storageName);
    writeFileSync(filePath, contents, { flag: 'wx', mode: 0o600 });
    try {
      transaction(db, () => {
        const current = requireCurrentUser(db, req, user);
        requirePermission(db, current, 'inventory', 'edit');
        itemRow(db, photoCreate[1], fail);
        db.prepare(`INSERT INTO inventory_item_photos (id, item_id, original_name,
          mime_type, size_bytes, storage_name, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, photoCreate[1], originalName, mime, contents.length, storageName,
            current.id, now());
        audit(db, current.id, 'inventory_photo', id, 'uploaded', { itemId: photoCreate[1] });
      });
    } catch (error) { try { unlinkSync(filePath); } catch { /* Evita órfão quando possível. */ } throw error; }
    return json(res, 201, { photo: photosDto(db, photoCreate[1]).find((entry) => entry.id === id) });
  }

  const movementMatch = path.match(/^\/api\/inventory\/items\/([^/]+)\/movements$/);
  if (movementMatch && method === 'POST') {
    requirePermission(db, user, 'inventory', 'edit');
    const body = await bodyJson(req);
    const kind = body.type;
    if (!['in', 'out'].includes(kind)) fail(422, 'Tipo de movimentação inválido.');
    const quantity = count(body.quantity, 'Quantidade', fail, 1);
    const reason = valueText(body.reason, 'Motivo', 300, fail, true);
    const eventId = body.eventId || null;
    const movementId = transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'inventory', 'edit');
      if (eventId) requireEvent(db, current, eventId, fail);
      const row = itemRow(db, movementMatch[1], fail);
      const newQty = row.stock_quantity + (kind === 'in' ? quantity : -quantity);
      if (newQty < 0) fail(409, 'Estoque insuficiente para esta baixa.');
      if (newQty < peakReserved(db, row.id)) fail(409,
        'A baixa deixaria reservas de eventos sem quantidade suficiente.');
      db.prepare('UPDATE inventory_items SET stock_quantity = ?, updated_at = ? WHERE id = ?')
        .run(newQty, now(), row.id);
      const id = randomUUID();
      db.prepare(`INSERT INTO inventory_movements
        (id, item_id, event_id, kind, quantity, reason, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, row.id, eventId, kind, quantity, reason, current.id, now());
      audit(db, current.id, 'inventory_item', row.id, 'stock_moved',
        { movementId: id, kind, quantity, eventId });
      return id;
    });
    return json(res, 201, { movementId, item: itemDto(db, itemRow(db, movementMatch[1], fail)) });
  }

  const itemMatch = path.match(/^\/api\/inventory\/items\/([^/]+)$/);
  if (itemMatch && method === 'GET') {
    const row = itemRow(db, itemMatch[1], fail);
    const item = itemDto(db, row);
    const movements = db.prepare(`SELECT m.id, m.event_id, e.name AS event_name, m.kind,
      m.quantity, m.reason, m.created_at FROM inventory_movements m
      LEFT JOIN events e ON e.id = m.event_id WHERE m.item_id = ?
      ${user.role === 'team' ? `AND (m.event_id IS NULL OR EXISTS
        (SELECT 1 FROM event_team et WHERE et.event_id = m.event_id AND et.user_id = ?))` : ''}
      ORDER BY m.created_at DESC LIMIT 100`).all(row.id, ...(user.role === 'team' ? [user.id] : []))
      .map((entry) => ({ id: entry.id, eventId: entry.event_id,
        eventName: entry.event_name, type: entry.kind, quantity: entry.quantity,
        reason: entry.reason, createdAt: entry.created_at }));
    const reservations = db.prepare(`SELECT r.* FROM inventory_reservations r
      WHERE r.item_id = ? ${user.role === 'team' ? `AND EXISTS
        (SELECT 1 FROM event_team et WHERE et.event_id = r.event_id AND et.user_id = ?)` : ''}
      ORDER BY r.starts_at DESC LIMIT 100`).all(row.id, ...(user.role === 'team' ? [user.id] : []))
      .map((entry) => reservationDto(db, entry));
    return json(res, 200, { item, movements, reservations });
  }

  if (itemMatch && method === 'PATCH') {
    requirePermission(db, user, 'inventory', 'edit');
    const body = await bodyJson(req);
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'inventory', 'edit');
      const row = itemRow(db, itemMatch[1], fail);
      if (own(body, 'stockQty')) fail(422,
        'Use uma movimentação para alterar a quantidade em estoque.');
      const data = validateItem(body, db, fail, {
        name: row.name, category: row.category, ownership: row.ownership, unit: row.unit,
        dimensions: row.dimensions, description: row.description,
        supplierId: row.supplier_id, active: Boolean(row.active),
      });
      if (!data.active && db.prepare(`SELECT 1 FROM inventory_reservations
        WHERE item_id = ? AND status = 'reserved' LIMIT 1`).get(row.id)) {
        fail(409, 'Libere as reservas antes de arquivar o item.');
      }
      db.prepare(`UPDATE inventory_items SET name=?, category=?, ownership=?, unit=?,
        dimensions=?, description=?, supplier_id=?, active=?, updated_at=? WHERE id=?`)
        .run(data.name, data.category, data.ownership, data.unit, data.dimensions,
          data.description, data.supplierId, data.active ? 1 : 0, now(), row.id);
      audit(db, current.id, 'inventory_item', row.id, 'updated', { fields: Object.keys(body) });
    });
    return json(res, 200, { item: itemDto(db, itemRow(db, itemMatch[1], fail)) });
  }

  if (path === '/api/inventory/reservations' && method === 'GET') {
    const eventId = valueText(url.searchParams.get('eventId'), 'Evento', 100, fail);
    const itemId = valueText(url.searchParams.get('itemId'), 'Item', 100, fail);
    if (eventId) requireEvent(db, user, eventId, fail);
    const clauses = []; const args = [];
    if (user.role === 'team') { clauses.push(`EXISTS (SELECT 1 FROM event_team et
      WHERE et.event_id = r.event_id AND et.user_id = ?)`); args.push(user.id); }
    if (eventId) { clauses.push('r.event_id = ?'); args.push(eventId); }
    if (itemId) { clauses.push('r.item_id = ?'); args.push(itemId); }
    const rows = db.prepare(`SELECT r.* FROM inventory_reservations r
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY r.starts_at DESC, r.id DESC`).all(...args);
    return json(res, 200, { reservations: rows.map((row) => reservationDto(db, row)) });
  }

  if (path === '/api/inventory/reservations' && method === 'POST') {
    requirePermission(db, user, 'inventory', 'edit');
    const body = await bodyJson(req);
    const itemId = valueText(body.itemId, 'Item', 100, fail, true);
    const eventId = valueText(body.eventId, 'Evento', 100, fail, true);
    const quantity = count(body.quantity, 'Quantidade', fail, 1);
    const startsAt = iso(body.startAt, 'Início da reserva', fail);
    const endsAt = iso(body.endAt, 'Fim da reserva', fail);
    if (startsAt >= endsAt) fail(422, 'O fim da reserva deve ser posterior ao início.');
    const notes = valueText(body.notes, 'Observações', 1000, fail);
    const id = transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'inventory', 'edit');
      requireEvent(db, current, eventId, fail);
      const item = itemRow(db, itemId, fail);
      if (!item.active) fail(409, 'Item arquivado não pode ser reservado.');
      if (peakReserved(db, itemId, { starts_at: startsAt, ends_at: endsAt, quantity }) >
          item.stock_quantity) {
        fail(409, 'Conflito de reserva: quantidade insuficiente no período informado.');
      }
      const id = randomUUID(); const timestamp = now();
      db.prepare(`INSERT INTO inventory_reservations
        (id, item_id, event_id, quantity, starts_at, ends_at, notes, created_by,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, itemId, eventId, quantity, startsAt, endsAt, notes, current.id,
          timestamp, timestamp);
      audit(db, current.id, 'inventory_reservation', id, 'created',
        { itemId, eventId, quantity, startsAt, endsAt });
      return id;
    });
    const row = db.prepare('SELECT * FROM inventory_reservations WHERE id = ?').get(id);
    return json(res, 201, { reservation: reservationDto(db, row) });
  }

  const reservationMatch = path.match(/^\/api\/inventory\/reservations\/([^/]+)$/);
  if (reservationMatch && method === 'PATCH') {
    requirePermission(db, user, 'inventory', 'edit');
    const body = await bodyJson(req);
    if (!['released', 'completed'].includes(body.status)) fail(422, 'Situação inválida.');
    transaction(db, () => {
      const current = requireCurrentUser(db, req, user);
      requirePermission(db, current, 'inventory', 'edit');
      const row = db.prepare('SELECT * FROM inventory_reservations WHERE id = ?')
        .get(reservationMatch[1]);
      if (!row) fail(404, 'Reserva não encontrada.');
      requireEvent(db, current, row.event_id, fail);
      if (row.status !== 'reserved') fail(409, 'Reserva já encerrada.');
      db.prepare('UPDATE inventory_reservations SET status = ?, updated_at = ? WHERE id = ?')
        .run(body.status, now(), row.id);
      audit(db, current.id, 'inventory_reservation', row.id, body.status);
    });
    const row = db.prepare('SELECT * FROM inventory_reservations WHERE id = ?')
      .get(reservationMatch[1]);
    return json(res, 200, { reservation: reservationDto(db, row) });
  }

  fail(404, 'Rota de acervo não encontrada.');
}
