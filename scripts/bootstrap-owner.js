// Inicializa o primeiro proprietário. Defina OWNER_NAME, OWNER_EMAIL,
// OWNER_PASSWORD (mínimo 12 caracteres) e opcionalmente DATABASE_PATH.
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/security.js';

const name = process.env.OWNER_NAME?.trim();
const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.OWNER_PASSWORD;
if (!name || !email || !password) {
  console.error('Defina OWNER_NAME, OWNER_EMAIL e OWNER_PASSWORD no ambiente.');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('OWNER_EMAIL inválido.');
  process.exit(1);
}
const db = openDatabase();
try {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'owner'").get()) {
    console.error('Já existe um proprietário. Não foi feita nenhuma alteração.');
    process.exitCode = 1;
  } else {
    db.prepare(`INSERT INTO users
      (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)`)
      .run(randomUUID(), name, email, hashPassword(password), new Date().toISOString());
    console.log(`Proprietário criado: ${email}`);
  }
} finally { db.close(); }
