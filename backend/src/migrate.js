import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/Migration');

export async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const files = (await fs.readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
    if (done.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationDirectory, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
      await client.query('COMMIT');
      console.log(`Migration angewendet: ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
