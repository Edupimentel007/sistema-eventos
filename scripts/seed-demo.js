// Dados fictícios em banco separado. Exige DEMO_DATABASE_PATH,
// DEMO_OWNER_PASSWORD e DEMO_CLIENT_PASSWORD; nunca altera DATABASE_PATH.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { openDatabase, transaction } from '../server/db.js';
import { hashPassword } from '../server/security.js';
import { syncAutomations } from '../server/notifications.js';

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

      // Fluxo financeiro fictício: valor contratado, parcelas, recebimento parcial,
      // custos do evento e uma despesa geral da empresa.
      const financial = (direction, title, event, category, supplier, installments,
        sharedWithClient = false) => {
        const id = randomUUID();
        const total = installments.reduce((sum, item) => sum + item.amountCents, 0);
        db.prepare(`INSERT INTO financial_accounts
          (id, direction, title, event_id, category, supplier_name, amount_cents,
           shared_with_client, notes, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, direction, title, event, category, supplier, total,
            sharedWithClient ? 1 : 0, 'Registro fictício para demonstração.',
            ownerId, timestamp, timestamp);
        const ids = installments.map((item, index) => {
          const installmentId = randomUUID();
          db.prepare(`INSERT INTO financial_installments
            (id, account_id, sequence, due_date, amount_cents, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(installmentId, id, index + 1, item.dueDate, item.amountCents,
              timestamp, timestamp);
          return installmentId;
        });
        return { id, installmentIds: ids };
      };
      const received = financial('receivable', 'Contrato de organização e decoração',
        eventId, 'Serviços', '', [
          { amountCents: 7_200_000, dueDate: '2026-10-20' },
          { amountCents: 6_300_000, dueDate: '2027-04-20' },
          { amountCents: 4_500_000, dueDate: '2027-06-01' },
        ], true);
      financial('payable', 'Flores e folhagens', eventId, 'Flores', 'Flora Exemplo', [
        { amountCents: 2_100_000, dueDate: '2027-05-20' },
        { amountCents: 2_100_000, dueDate: '2027-06-12' },
      ]);
      financial('payable', 'Locação de mobiliário', eventId, 'Mobiliário',
        'Acervo Exemplo', [{ amountCents: 1_800_000, dueDate: '2027-06-10' }]);
      financial('payable', 'Despesas administrativas', null, 'Outros', '',
        [{ amountCents: 250_000, dueDate: '2026-10-15' }]);
      const paymentId = randomUUID();
      db.prepare(`INSERT INTO financial_payments
        (id, account_id, paid_on, amount_cents, payment_method, reference,
         notes, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(paymentId, received.id, '2026-10-20', 7_200_000, 'Pix',
          'DEMO-PIX-001', '', ownerId, timestamp);
      db.prepare(`INSERT INTO financial_payment_allocations
        (payment_id, installment_id, amount_cents) VALUES (?, ?, ?)`)
        .run(paymentId, received.installmentIds[0], 7_200_000);

      // Fornecedores, mobiliário e reserva do casamento para explorar os novos módulos.
      const furnitureSupplierId = randomUUID();
      const flowerSupplierId = randomUUID();
      const supplierInsert = db.prepare(`INSERT INTO suppliers
        (id, name, category, contact_name, email, phone, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      supplierInsert.run(furnitureSupplierId, 'Acervo Exemplo', 'Mobiliário', 'Marina Costa',
        'marina@example.com', '+5511999993333', 'Fornecedor fictício para demonstração.',
        ownerId, timestamp, timestamp);
      supplierInsert.run(flowerSupplierId, 'Flora Exemplo', 'Flores', 'Clara Souza',
        'clara@example.com', '+5511999994444', 'Fornecedor fictício para demonstração.',
        ownerId, timestamp, timestamp);
      const offeringInsert = db.prepare(`INSERT INTO supplier_offerings
        (id, supplier_id, name, category, unit, notes, position) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      offeringInsert.run(randomUUID(), furnitureSupplierId, 'Cadeiras Chiavari', 'Cadeiras',
        'unidade', 'Madeira clara', 1);
      offeringInsert.run(randomUUID(), furnitureSupplierId, 'Mesas redondas', 'Mesas',
        'unidade', '8 lugares', 2);
      offeringInsert.run(randomUUID(), flowerSupplierId, 'Rosas brancas', 'Flores',
        'maço', 'Sazonalidade a confirmar', 1);
      offeringInsert.run(randomUUID(), flowerSupplierId, 'Eucalipto', 'Folhagens',
        'maço', '', 2);
      const chairId = randomUUID();
      db.prepare(`INSERT INTO inventory_items
        (id, name, category, ownership, unit, dimensions, description, supplier_id,
         stock_quantity, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(chairId, 'Cadeira Chiavari de madeira', 'Cadeiras', 'rental', 'unidade',
          '45 × 90 cm', 'Modelo claro para cerimônia e recepção.', furnitureSupplierId,
          60, ownerId, timestamp, timestamp);
      db.prepare(`INSERT INTO inventory_movements
        (id, item_id, kind, quantity, reason, created_by, created_at)
        VALUES (?, ?, 'in', ?, ?, ?, ?)`)
        .run(randomUUID(), chairId, 60, 'Estoque inicial', ownerId, timestamp);
      db.prepare(`INSERT INTO inventory_reservations
        (id, item_id, event_id, quantity, starts_at, ends_at, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), chairId, eventId, 40, '2027-06-18T12:00:00.000Z',
          '2027-06-21T12:00:00.000Z', 'Separação, montagem e devolução — demonstração.',
          ownerId, timestamp, timestamp);
      db.prepare(`INSERT INTO message_rules
        (id, name, occasion, channel, offset_minutes, send_time, event_type,
         subject_template, body_template, created_by, created_at, updated_at)
        VALUES (?, ?, 'event_start', 'internal', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), 'Lembrete do casamento — demonstração', -10080, '09:00',
          'casamento', 'Seu casamento está chegando',
          'Olá {cliente}, o evento {evento} acontece em {data_evento}, às {hora_evento}.',
          ownerId, timestamp, timestamp);
    });
    syncAutomations(db);
    console.log(`Dados fictícios criados em ${resolve(demoPath)}.`);
    console.log('Contas: proprietario@example.com, ana.oliveira@example.com e lucas.pereira@example.com.');
  }
} finally { db.close(); }
