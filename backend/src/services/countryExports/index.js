import {
  readdir,
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

const directory = path.dirname(
  fileURLToPath(import.meta.url),
);

let registryPromise;

function normalizeCountryCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function loadRegistry() {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const moduleFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^[a-z]{2}\.js$/i.test(entry.name),
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name),
    );

  const importedModules = await Promise.all(
    moduleFiles.map(async (entry) => {
      const absolutePath = path.join(
        directory,
        entry.name,
      );

      const imported = await import(
        pathToFileURL(absolutePath).href
      );

      return {
        filename: entry.name,
        profile: imported.default,
      };
    }),
  );

  const registry = new Map();

  for (const {
    filename,
    profile,
  } of importedModules) {
    if (
      !profile ||
      typeof profile !== "object" ||
      !/^[A-Z]{2}$/.test(profile.code) ||
      !profile.name ||
      typeof profile.toPublicDefinition !==
        "function"
    ) {
      throw new Error(
        `Ungültiges Länder-Exportmodul: ${filename}`,
      );
    }

    if (registry.has(profile.code)) {
      throw new Error(
        `Doppeltes Länder-Exportmodul: ${profile.code}`,
      );
    }

    registry.set(profile.code, profile);
  }

  if (registry.size === 0) {
    throw new Error(
      "Es wurden keine Länder-Exportmodule gefunden.",
    );
  }

  return registry;
}

async function getRegistry() {
  if (!registryPromise) {
    registryPromise = loadRegistry();
  }

  return registryPromise;
}

export async function listCountryExports(
  now = new Date(),
) {
  const registry = await getRegistry();

  return [...registry.values()]
    .map((profile) =>
      profile.toPublicDefinition(now),
    )
    .sort((left, right) =>
      left.name.localeCompare(
        right.name,
        "de",
      ),
    );
}

export async function isCountryExportSupported(
  countryCode,
) {
  const registry = await getRegistry();

  return registry.has(
    normalizeCountryCode(countryCode),
  );
}

export async function getCountryExport(
  countryCode,
  {
    fallbackCode = "DE",
  } = {},
) {
  const registry = await getRegistry();
  const normalized =
    normalizeCountryCode(countryCode);

  const selected =
    registry.get(normalized) ||
    registry.get(
      normalizeCountryCode(fallbackCode),
    ) ||
    registry.values().next().value;

  if (!selected) {
    throw new Error(
      "Kein Länder-Exportmodul verfügbar.",
    );
  }

  return selected;
}
