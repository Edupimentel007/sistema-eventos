// Banco local da Etapa 1. DATABASE_PATH aponta para um arquivo persistente;
// as migrações são aplicadas automaticamente ao iniciar a API.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const migrationsDir = resolve(import.meta.dirname, '..', 'migrations');

export function openDatabase(filePath = process.env.DATABASE_PATH || 'data/events.sqlite') {
  const resolvedPath = filePath === ':memory:' ? filePath : resolve(filePath);
  if (resolvedPath !== ':memory:') mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (resolvedPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name);
    if (applied) continue;
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
