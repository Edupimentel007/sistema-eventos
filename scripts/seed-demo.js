// Dados fictícios em banco separado. Exige DEMO_DATABASE_PATH,
// DEMO_OWNER_PASSWORD e DEMO_CLIENT_PASSWORD; nunca altera DATABASE_PATH.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { openDatabase, transaction } from '../server/db.js';
import { hashPassword } from '../server/security.js';

const demoPath = process.env.DEMO_DATABASE_PATH;
if (!demoPath || demoPath === ':memory:' ||
    resolve(demoPath) === resolve(process.env.DATABASE_PATH || 'data/events.sqlite')) {
  console.error('Defina DEMO_DATABASE_PATH para um arquivo separado do banco principal.');
  process.exit(1);
}
if (!process.env.DEMO_OWNER_PASSWORD || !process.env.DEMO_CLIENT_PASSWORD) {
  console.error('Defina DEMO_OWNER_PASSWORD e DEMO_CLIENT_PASSWORD (mínimo 12 caracteres).');
  process.exit(1);
}
const db = openDatabase(demoPath);
try {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get() || db.prepare('SELECT 1 FROM events LIMIT 1').get()) {
    console.error('O banco de demonstração já contém dados; nenhuma alteração feita.');
    process.exitCode = 1;
  } else {
    const timestamp = new Date().toISOString();
    const ownerId = randomUUID();
    const eventId = randomUUID();
    const clients = [
      { id: randomUUID(), userId: randomUUID(), name: 'Ana Oliveira', email: 'ana.oliveira@example.com', phone: '(11) 99999-1111' },
      { id: randomUUID(), userId: randomUUID(), name: 'Lucas Pereira', email: 'lucas.pereira@example.com', phone: '(11) 99999-2222' },
    ];
    transaction(db, () => {
      db.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, 'owner', ?)`)
        .run(ownerId, 'Proprietário Demonstração', 'proprietario@example.com',
          hashPassword(process.env.DEMO_OWNER_PASSWORD), timestamp);
      for (const client of clients) {
        db.prepare('INSERT INTO clients (id, name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(client.id, client.name, client.email, client.phone, timestamp, timestamp);
        db.prepare(`INSERT INTO users (id, name, email, password_hash, role, client_id, created_at)
          VALUES (?, ?, ?, ?, 'client', ?, ?)`)
          .run(client.userId, client.name, client.email,
            hashPassword(process.env.DEMO_CLIENT_PASSWORD), client.id, timestamp);
      }
      db.prepare(`INSERT INTO events
        (id, code, name, type, status, start_at, end_at, timezone, guest_estimated,
         ceremony_name, reception_name, ceremony_address, reception_address,
         city, state, internal_notes, responsible_user_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 'casamento', 'contratado', ?, ?, 'America/Sao_Paulo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(eventId, 'EVT-2027-DEMO0001', 'Casamento Ana e Lucas',
          '2027-06-19T19:00:00.000Z', '2027-06-20T04:00:00.000Z', 180,
          'Capela das Flores', 'Espaço Jardim',
          'Rua das Camélias, 100, São Paulo, SP', 'Av. das Palmeiras, 250, São Paulo, SP',
          'São Paulo', 'SP', 'Anotação interna fictícia para validar isolamento.',
          ownerId, ownerId, timestamp, timestamp);
      for (const client of clients) {
        db.prepare('INSERT INTO event_clients (event_id, client_id, created_at) VALUES (?, ?, ?)')
          .run(eventId, client.id, timestamp);
      }
      db.prepare('INSERT INTO event_team (event_id, user_id, created_at) VALUES (?, ?, ?)')
        .run(eventId, ownerId, timestamp);
    });
    console.log(`Dados fictícios criados em ${resolve(demoPath)}.`);
    console.log('Contas: proprietario@example.com, ana.oliveira@example.com e lucas.pereira@example.com.');
  }
} finally { db.close(); }
