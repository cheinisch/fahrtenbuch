// Vollständige Datenbanksicherung per pg_dump/pg_restore – für die
// Kommandozeile im Container (`docker exec fahrtenbuch-app fahrtenbuch …`).
// Anders als der JSON-Export enthält der Dump alle Tabellen, Sequenzen und
// den Migrationsstand und lässt sich 1:1 zurückspielen.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { config } from "../config.js";

export const BACKUP_EXTENSION = ".dump";
export const BACKUP_PREFIX = "fahrtenbuch-db-";

// Erste Bytes eines pg_dump-Archivs im Custom-Format.
const CUSTOM_FORMAT_MAGIC = "PGDMP";

export function backupFileName(date = new Date(), label = "") {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  const suffix = label ? `-${sanitizeLabel(label)}` : "";
  return `${BACKUP_PREFIX}${stamp}${suffix}${BACKUP_EXTENSION}`;
}

export function sanitizeLabel(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Verbindung für die PostgreSQL-Werkzeuge. Das Passwort geht über die
// Umgebung, nie über die Kommandozeile (sonst in `ps` sichtbar).
export function pgEnvironment(database = config.database) {
  return {
    ...process.env,
    PGHOST: database.host,
    PGPORT: String(database.port),
    PGDATABASE: database.database,
    PGUSER: database.user,
    PGPASSWORD: database.password,
    ...(database.ssl ? { PGSSLMODE: "require" } : {}),
  };
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(file) {
  try {
    await fs.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Sucht pg_dump/pg_restore/psql passend zur Serverversion. Alpine legt jede
// Hauptversion unter /usr/libexec/postgresqlNN ab, Debian unter
// /usr/lib/postgresql/NN/bin. Gleiche Hauptversion bevorzugt; sonst eine
// neuere (pg_dump kann ältere Server sichern), zuletzt der PATH.
export async function findPgTools(serverMajor) {
  const majors = [serverMajor];
  for (let major = serverMajor + 1; major <= serverMajor + 4; major += 1) {
    majors.push(major);
  }

  for (const major of majors) {
    for (const directory of [
      `/usr/libexec/postgresql${major}`,
      `/usr/lib/postgresql/${major}/bin`,
    ]) {
      const tools = {
        pgDump: path.join(directory, "pg_dump"),
        pgRestore: path.join(directory, "pg_restore"),
        psql: path.join(directory, "psql"),
      };
      if (
        (await isExecutable(tools.pgDump)) &&
        (await isExecutable(tools.pgRestore)) &&
        (await isExecutable(tools.psql))
      ) {
        return { ...tools, major, exact: major === serverMajor };
      }
    }
  }

  const fallback = { pgDump: "pg_dump", pgRestore: "pg_restore", psql: "psql" };
  const version = await toolMajor(fallback.pgDump);
  if (version === null) {
    throw new Error(
      "pg_dump wurde nicht gefunden. Das Image enthält die PostgreSQL-Werkzeuge ab dieser Version – bitte das Image aktualisieren.",
    );
  }
  return { ...fallback, major: version, exact: version === serverMajor };
}

async function toolMajor(binary) {
  try {
    const { stdout } = await run(binary, ["--version"], { env: process.env });
    const match = stdout.match(/(\d+)(?:\.\d+)?/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export async function serverMajorVersion(pool) {
  const result = await pool.query("SHOW server_version_num");
  return Math.floor(Number(result.rows[0].server_version_num) / 10000);
}

function run(binary, args, { env, input, stdout: stdoutTarget } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    if (stdoutTarget) {
      child.stdout.pipe(stdoutTarget, { end: false });
    } else {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${path.basename(binary)} beendet mit Code ${code}: ${stderr.trim() || "ohne Meldung"}`,
          ),
        );
      }
    });

    if (input) {
      // Beendet sich der Prozess vorzeitig (Fehler), nicht an EPIPE abstürzen –
      // der Exit-Code meldet den eigentlichen Fehler.
      child.stdin.on("error", () => {});
      input.pipe(child.stdin);
    }
  });
}

// Schreibt den Dump in eine Datei (atomar über .partial) oder einen Stream.
export async function createDatabaseBackup(
  pool,
  { directory = config.backupDirectory, label = "", output = null, record = true } = {},
) {
  const serverMajor = await serverMajorVersion(pool);
  const tools = await findPgTools(serverMajor);
  const args = ["--format=custom", "--compress=6", "--no-owner", "--no-privileges"];
  const env = pgEnvironment();

  if (output) {
    await run(tools.pgDump, args, { env, stdout: output });
    return { tools, serverMajor };
  }

  await fs.mkdir(directory, { recursive: true });
  let fileName = backupFileName(new Date(), label);
  // Zwei Sicherungen in derselben Sekunde dürfen sich nicht überschreiben.
  for (let counter = 2; await fileExists(path.join(directory, fileName)); counter += 1) {
    fileName = fileName.replace(/(-\d+)?\.dump$/, `-${counter}.dump`);
  }
  const filePath = path.join(directory, fileName);
  const partialPath = `${filePath}.partial`;

  try {
    await run(tools.pgDump, [...args, `--file=${partialPath}`], { env });
    await fs.chmod(partialPath, 0o600);
    await fs.rename(partialPath, filePath);
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    throw error;
  }

  const { size } = await fs.stat(filePath);
  if (record) {
    await recordBackupJob(pool, fileName, size);
  }
  return { fileName, filePath, sizeBytes: size, tools, serverMajor };
}

// Damit die Sicherung auch in der Administration (System) auftaucht.
async function recordBackupJob(pool, fileName, sizeBytes) {
  try {
    await pool.query(
      `
        INSERT INTO backup_jobs (status, file_name, file_size_bytes, started_at, completed_at)
        VALUES ('completed', $1, $2, now(), now())
      `,
      [fileName, sizeBytes],
    );
  } catch {
    // Nur Anzeige – eine fehlende Tabelle (sehr alte DB) ist kein Fehler.
  }
}

export async function listDatabaseBackups(directory = config.backupDirectory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(BACKUP_EXTENSION)) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    const stat = await fs.stat(filePath);
    backups.push({
      fileName: entry.name,
      filePath,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime,
    });
  }
  return backups.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

// "latest", ein Dateiname aus dem Backup-Verzeichnis oder ein Pfad.
export async function resolveBackupFile(reference, directory = config.backupDirectory) {
  if (!reference) {
    throw new Error("Bitte eine Sicherung angeben (Dateiname, Pfad oder \"latest\").");
  }

  if (reference === "latest") {
    const [latest] = await listDatabaseBackups(directory);
    if (!latest) {
      throw new Error(`Im Verzeichnis ${directory} liegt keine Sicherung.`);
    }
    return latest.filePath;
  }

  const candidates = path.isAbsolute(reference)
    ? [reference]
    : [path.join(directory, reference), path.resolve(reference)];
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // nächster Kandidat
    }
  }
  throw new Error(`Sicherung "${reference}" nicht gefunden (gesucht in ${directory}).`);
}

// Nimmt einen Dump von stdin entgegen und legt ihn im Backup-Verzeichnis ab,
// damit pg_restore ihn mehrfach lesen kann.
export async function saveIncomingBackup(input, directory = config.backupDirectory) {
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, backupFileName(new Date(), "import"));
  await pipeline(input, createWriteStream(filePath, { mode: 0o600 }));
  return filePath;
}

export async function assertCustomFormat(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(CUSTOM_FORMAT_MAGIC.length);
    await handle.read(buffer, 0, buffer.length, 0);
    if (buffer.toString("latin1") !== CUSTOM_FORMAT_MAGIC) {
      throw new Error(
        `${path.basename(filePath)} ist keine Datenbanksicherung (pg_dump-Custom-Format erwartet). JSON-Exporte werden in der Weboberfläche importiert.`,
      );
    }
  } finally {
    await handle.close();
  }
}

// Liest die Migrationsliste aus dem COPY-Block von schema_migrations.
export function parseSchemaMigrationsCopy(sql) {
  const lines = sql.split("\n");
  const start = lines.findIndex((line) =>
    /^COPY (public\.)?schema_migrations \(/.test(line),
  );
  if (start === -1) {
    return [];
  }
  const columns = lines[start]
    .slice(lines[start].indexOf("(") + 1, lines[start].indexOf(")"))
    .split(",")
    .map((column) => column.trim());
  const index = columns.indexOf("filename");
  const filenames = [];
  for (const line of lines.slice(start + 1)) {
    if (line === "\\.") {
      break;
    }
    if (line) {
      filenames.push(line.split("\t")[index]);
    }
  }
  return filenames.sort();
}

export async function backupMigrations(tools, filePath) {
  const { stdout } = await run(
    tools.pgRestore,
    ["--data-only", "--table=schema_migrations", "--file=-", filePath],
    { env: process.env },
  );
  return parseSchemaMigrationsCopy(stdout);
}

export async function knownMigrations(migrationsDirectory) {
  return (await fs.readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
}

// Neuere pg_restore-Versionen setzen Parameter, die ältere Server nicht
// kennen (17: transaction_timeout). Nur im Kopf des Skripts filtern.
export function createSetFilter(serverMajor) {
  const unsupported = [];
  if (serverMajor < 17) {
    unsupported.push("transaction_timeout");
  }
  let pending = "";
  let headerDone = unsupported.length === 0;
  const pattern = new RegExp(`^SET (${unsupported.join("|")}) = `);

  return new Transform({
    transform(chunk, _encoding, callback) {
      if (headerDone) {
        callback(null, chunk);
        return;
      }
      pending += chunk.toString("utf8");
      const lastNewline = pending.lastIndexOf("\n");
      if (lastNewline === -1 && pending.length < 65536) {
        callback();
        return;
      }
      const complete = lastNewline === -1 ? pending : pending.slice(0, lastNewline + 1);
      pending = lastNewline === -1 ? "" : pending.slice(lastNewline + 1);
      const kept = [];
      for (const line of complete.split("\n")) {
        if (/^(CREATE|COPY|ALTER|COMMENT) /.test(line)) {
          headerDone = true;
        }
        if (!headerDone && pattern.test(line)) {
          continue;
        }
        kept.push(line);
      }
      const output = kept.join("\n");
      if (headerDone) {
        callback(null, output + pending);
        pending = "";
      } else {
        callback(null, output);
      }
    },
    flush(callback) {
      callback(null, pending);
    },
  });
}

// Spielt eine Sicherung in einer Transaktion zurück: Schema public
// leeren und neu anlegen, dann den Dump einspielen. Schlägt etwas fehl,
// bleibt die Datenbank unverändert.
export async function restoreDatabaseBackup(pool, filePath) {
  await assertCustomFormat(filePath);
  const serverMajor = await serverMajorVersion(pool);
  const tools = await findPgTools(serverMajor);
  const env = pgEnvironment();

  const restore = spawn(
    tools.pgRestore,
    ["--no-owner", "--no-privileges", "--file=-", filePath],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let restoreError = "";
  restore.stderr.setEncoding("utf8");
  restore.stderr.on("data", (chunk) => {
    restoreError += chunk;
  });
  const restoreClosed = new Promise((resolve, reject) => {
    restore.on("error", reject);
    restore.on("close", resolve);
  });

  // Transaktion selbst steuern: COMMIT nur, wenn pg_restore vollständig
  // durchgelaufen ist. Bricht pg_restore ab, endet psql ohne COMMIT und die
  // Datenbank bleibt unverändert.
  const input = new PassThrough();
  input.write(
    [
      "\\set ON_ERROR_STOP 1",
      "BEGIN;",
      "SET client_min_messages = warning;",
      "DROP SCHEMA IF EXISTS public CASCADE;",
      "CREATE SCHEMA public;",
      "",
    ].join("\n"),
  );
  const script = restore.stdout.pipe(createSetFilter(serverMajor));
  script.pipe(input, { end: false });
  const scriptEnded = new Promise((resolve) => script.on("end", resolve));

  const psql = run(tools.psql, ["--no-psqlrc", "--quiet", "--file=-"], { env, input });
  psql.catch(() => {}); // wird unten ausgewertet
  // Bricht psql ab (SQL-Fehler), liest niemand mehr – pg_restore würde sonst
  // ewig auf die volle Pipe warten.
  let restoreRunning = true;
  restore.on("close", () => {
    restoreRunning = false;
  });
  psql.finally(() => {
    if (restoreRunning) {
      script.unpipe(input);
      script.resume();
      restore.kill("SIGTERM");
    }
  }).catch(() => {});

  const [restoreCode] = await Promise.all([restoreClosed, scriptEnded]);
  input.end(restoreCode === 0 ? "\nCOMMIT;\n" : "\nROLLBACK;\n");
  await psql;

  if (restoreCode !== 0) {
    throw new Error(`pg_restore beendet mit Code ${restoreCode}: ${restoreError.trim()}`);
  }
  return { tools, serverMajor };
}

export function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

