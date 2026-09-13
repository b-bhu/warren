import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Sqlite = Database.Database;
export function openDatabase(url: string): Sqlite {
  const filename = url.startsWith('file:') ? url.slice(5) : url;
  const db = new Database(filename);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000'); db.pragma('synchronous = FULL');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrationDirectory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrationDirectory).filter((entry) => entry.endsWith('.sql')).sort()) {
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(file)) {
      db.exec(readFileSync(join(migrationDirectory.pathname, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    }
  }
  return db;
}
