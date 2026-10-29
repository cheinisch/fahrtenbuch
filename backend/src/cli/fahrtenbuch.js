#!/usr/bin/env node
// Kommandozeile im Container:
//   docker exec fahrtenbuch-app fahrtenbuch backup
//   docker exec -it fahrtenbuch-app fahrtenbuch restore latest
// Meldungen gehen nach stderr, damit `backup --stdout` einen sauberen Dump liefert.

import readline from "node:readline/promises";
import path from "node:path";

// dotenv meldet sich sonst auf stdout und würde einen Dump auf stdout zerstören.
process.env.DOTENV_CONFIG_QUIET ??= "true";
console.log = (...args) => console.error(...args);

const HELP = `Fahrtenbuch – Kommandozeile

Verwendung (auf dem Docker-Host):
  docker exec fahrtenbuch-app fahrtenbuch <befehl> [optionen]

Befehle:
  backup [--label <text>]       Vollständige Datenbanksicherung nach $BACKUP_DIR (/data/backups)
  backup --stdout               Sicherung auf stdout, z. B.
                                  docker exec fahrtenbuch-app fahrtenbuch backup --stdout > fb.dump
  backups                       Vorhandene Sicherungen auflisten
  restore <datei|latest|->      Sicherung zurückspielen (ersetzt ALLE Daten), "-" liest von stdin:
                                  docker exec -i fahrtenbuch-app fahrtenbuch restore - --yes < fb.dump
    --yes                       Ohne Rückfrage (nötig ohne Terminal, also ohne "docker exec -it")
    --no-safety-backup          Vorher keine Sicherung des aktuellen Stands anlegen
    --force                     Auch Sicherungen einer neueren Version zurückspielen
  help                          Diese Hilfe

Nach einem Restore: docker compose restart app worker`;

export function parseArguments(argv) {
  const result = { command: argv[0] ?? "help", positional: [], options: {} };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-") {
      result.positional.push(argument);
    } else if (argument.startsWith("--")) {
      const [name, inlineValue] = argument.slice(2).split("=", 2);
      if (name === "label") {
        result.options.label = inlineValue ?? argv[++index] ?? "";
      } else {
        result.options[name] = inlineValue ?? true;
      }
    } else {
      result.positional.push(argument);
    }
  }
  return result;
}

const CONFIRM_WORD = "wiederherstellen";

async function confirmRestore(filePath) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      `\nACHTUNG: Alle aktuellen Daten werden durch ${path.basename(filePath)} ersetzt.\n` +
        `Zum Fortfahren "${CONFIRM_WORD}" eingeben: `,
    );
    return answer.trim().toLowerCase() === CONFIRM_WORD;
  } finally {
    rl.close();
  }
}

async function main(argv) {
  const { command, positional, options } = parseArguments(argv);

  if (["help", "--help", "-h"].includes(command)) {
    console.error(HELP);
    return 0;
  }
  if (!["backup", "backups", "restore"].includes(command)) {
    console.error(`Unbekannter Befehl "${command}".\n\n${HELP}`);
    return 2;
  }

  // Erst jetzt laden: config.js liest die Umgebung und braucht DOTENV_CONFIG_QUIET.
  const { config } = await import("../config.js");
  const { pool } = await import("../database/pool.js");
  const backups = await import("../services/databaseBackupService.js");

  try {
    if (command === "backups") {
      const list = await backups.listDatabaseBackups();
      if (list.length === 0) {
        console.error(`Keine Sicherungen in ${config.backupDirectory}.`);
        return 0;
      }
      for (const backup of list) {
        process.stdout.write(
          `${backup.modifiedAt.toISOString()}  ${backups.formatBytes(backup.sizeBytes).padStart(9)}  ${backup.fileName}\n`,
        );
      }
      return 0;
    }

    if (command === "backup") {
      if (options.stdout) {
        if (process.stdout.isTTY) {
          console.error("--stdout schreibt Binärdaten – bitte in eine Datei umleiten (> fb.dump).");
          return 2;
        }
        await backups.createDatabaseBackup(pool, { output: process.stdout });
        console.error("Sicherung auf stdout geschrieben.");
        return 0;
      }
      const result = await backups.createDatabaseBackup(pool, { label: options.label });
      console.error(
        `Sicherung erstellt: ${result.filePath} (${backups.formatBytes(result.sizeBytes)}, PostgreSQL ${result.serverMajor}, pg_dump ${result.tools.major})`,
      );
      return 0;
    }

    // restore
    const reference = positional[0];
    let filePath;
    if (reference === "-") {
      if (!options.yes) {
        console.error("Beim Einlesen von stdin ist --yes erforderlich.");
        return 2;
      }
      filePath = await backups.saveIncomingBackup(process.stdin);
      console.error(`Sicherung empfangen: ${filePath}`);
    } else {
      filePath = await backups.resolveBackupFile(reference);
    }
    await backups.assertCustomFormat(filePath);

    const { findPgTools, serverMajorVersion, backupMigrations, knownMigrations } = backups;
    const { resolveMigrationsDirectory, runMigrations } = await import("../database/migrate.js");
    const tools = await findPgTools(await serverMajorVersion(pool));
    const known = new Set(await knownMigrations(await resolveMigrationsDirectory()));
    const contained = await backupMigrations(tools, filePath);
    const newer = contained.filter((filename) => !known.has(filename));

    if (contained.length === 0) {
      console.error("Hinweis: Die Sicherung enthält keinen Migrationsstand.");
    }
    if (newer.length > 0 && !options.force) {
      console.error(
        `Die Sicherung stammt von einer neueren Version (unbekannte Migrationen: ${newer.join(", ")}).\n` +
          "Bitte zuerst das Image aktualisieren oder mit --force erzwingen.",
      );
      return 1;
    }

    if (!options.yes) {
      if (!process.stdin.isTTY) {
        console.error('Keine Rückfrage möglich: mit "docker exec -it" aufrufen oder --yes angeben.');
        return 2;
      }
      if (!(await confirmRestore(filePath))) {
        console.error("Abgebrochen – es wurde nichts geändert.");
        return 1;
      }
    }

    if (!options["no-safety-backup"]) {
      const safety = await backups.createDatabaseBackup(pool, { label: "vor-restore" });
      console.error(`Aktueller Stand gesichert: ${safety.filePath}`);
    }

    console.error(`Spiele ${path.basename(filePath)} zurück …`);
    await backups.restoreDatabaseBackup(pool, filePath);

    // Ältere Sicherungen auf den Stand dieser Version bringen.
    await runMigrations();

    console.error(
      "Wiederherstellung abgeschlossen.\nBitte App und Worker neu starten: docker compose restart app worker",
    );
    return 0;
  } finally {
    await pool.end();
  }
}

const executedDirectly = process.argv[1] && /fahrtenbuch(\.js)?$/.test(process.argv[1]);

if (executedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`Fehler: ${error.message}`);
      process.exitCode = 1;
    });
}
