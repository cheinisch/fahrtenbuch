import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { pool } from "./pool.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

async function directoryExists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveMigrationsDirectory() {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(currentDirectory, "migrations"),
    "/app/database/migrations",
    path.resolve(currentDirectory, "../../../database/migrations"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Kein Migrationsverzeichnis gefunden. Geprüft: ${candidates.join(", ")}`,
  );
}

export async function runMigrations() {
  const migrationsDirectory = await resolveMigrationsDirectory();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const filenames = (await fs.readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const existing = await pool.query(
      `SELECT 1 FROM schema_migrations WHERE filename = $1`,
      [filename],
    );

    if (existing.rowCount > 0) {
      continue;
    }

    const sql = await fs.readFile(
      path.join(migrationsDirectory, filename),
      "utf8",
    );

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [filename],
      );
      await client.query("COMMIT");
      console.log(`Migration angewendet: ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      error.message = `Migration ${filename} fehlgeschlagen: ${error.message}`;
      throw error;
    } finally {
      client.release();
    }
  }
}

const executedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (executedDirectly) {
  runMigrations()
    .then(async () => {
      console.log("Migrationen abgeschlossen.");
      await pool.end();
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exitCode = 1;
    });
}
