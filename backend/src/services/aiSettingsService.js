import { badRequest, serviceUnavailable } from "../lib/errors.js";
import { decryptSecret, encryptSecret } from "../security/encryption.js";
import { readSetting, writeSetting } from "./serviceSettingsService.js";

// KI-Anbieter im Reiter „AI“ der Systemeinstellungen. Gespeichert unter app_settings "services.ai";
// API-Schlüssel liegen verschlüsselt in der DB (wie Dawarich/TOTP) und verlassen das Backend nie –
// die Admin-API meldet nur, ob einer hinterlegt ist.

export const AI_PROVIDERS = ["claude", "openai", "ollama"];
export const AI_ACTIVE_VALUES = ["disabled", ...AI_PROVIDERS];

const SETTING_KEY = "services.ai";

const DEFAULT_BASE_URLS = {
  claude: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  ollama: "",
};

function trimUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function normalize(value) {
  const stored = value && typeof value === "object" ? value : {};
  const providers = {};

  for (const provider of AI_PROVIDERS) {
    const entry = stored.providers?.[provider] || {};
    providers[provider] = {
      baseUrl: entry.baseUrl || "",
      model: entry.model || "",
      apiKey: entry.apiKeyEncrypted ? decryptOrEmpty(entry.apiKeyEncrypted) : "",
    };
  }

  return {
    activeProvider: AI_ACTIVE_VALUES.includes(stored.activeProvider) ? stored.activeProvider : "disabled",
    timeoutMs: Number(stored.timeoutMs || 60_000),
    providers,
  };
}

function decryptOrEmpty(value) {
  try {
    return decryptSecret(value);
  } catch {
    // Anderer Schlüssel (z. B. TOTP_ENCRYPTION_KEY geändert) – wie „nicht hinterlegt“ behandeln
    return "";
  }
}

/** Speicherform: Klartext-Schlüssel nur verschlüsselt ablegen. */
export function toStored(settings) {
  return {
    activeProvider: settings.activeProvider,
    timeoutMs: settings.timeoutMs,
    providers: Object.fromEntries(
      AI_PROVIDERS.map((provider) => {
        const { apiKey, ...rest } = settings.providers[provider];
        return [provider, { ...rest, apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null }];
      }),
    ),
  };
}

function maskKey(key) {
  return key ? `…${key.slice(-4)}` : null;
}

export async function readAiSettings(client) {
  const setting = await readSetting(SETTING_KEY, client);
  return normalize(setting.value);
}

/** Admin-Sicht ohne Schlüssel. */
export function publicAiSettings(settings) {
  return {
    activeProvider: settings.activeProvider,
    timeoutMs: settings.timeoutMs,
    providers: Object.fromEntries(
      AI_PROVIDERS.map((provider) => {
        const entry = settings.providers[provider];
        return [
          provider,
          {
            baseUrl: entry.baseUrl,
            defaultBaseUrl: DEFAULT_BASE_URLS[provider] || null,
            model: entry.model,
            apiKeySet: Boolean(entry.apiKey),
            apiKeyHint: maskKey(entry.apiKey),
          },
        ];
      }),
    ),
  };
}

function assertHttpUrl(label, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest("VALIDATION_ERROR", `${label} muss eine gültige URL inklusive http:// oder https:// sein.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw badRequest("VALIDATION_ERROR", `${label} muss http:// oder https:// verwenden.`);
  }
}

function optionalString(input, name, maximum) {
  const value = input?.[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ muss eine Zeichenkette sein.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maximum) {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ darf höchstens ${maximum} Zeichen lang sein.`);
  }
  return trimmed;
}

const LABELS = { claude: "Claude", openai: "OpenAI", ollama: "Ollama" };

/**
 * Eingabe eines Anbieters auf den gespeicherten Stand anwenden.
 * apiKey: leer/fehlend = unverändert lassen, clearApiKey: true = entfernen.
 */
export function mergeProviderInput(provider, current, input = {}) {
  const next = { ...current };
  const baseUrl = optionalString(input, "baseUrl", 2000);
  const model = optionalString(input, "model", 200);
  const apiKey = optionalString(input, "apiKey", 500);

  if (baseUrl !== undefined) {
    if (baseUrl) assertHttpUrl(`Die ${LABELS[provider]}-Serveradresse`, baseUrl);
    next.baseUrl = trimUrl(baseUrl);
  }
  if (model !== undefined) next.model = model;
  if (input.clearApiKey === true) next.apiKey = "";
  else if (apiKey) next.apiKey = apiKey;

  return next;
}

/** Fehlende Pflichtangaben eines Anbieters – leer = einsatzbereit. */
export function providerProblems(provider, entry) {
  const problems = [];
  if (provider === "ollama" && !entry.baseUrl) problems.push("Für Ollama fehlt die Serveradresse.");
  if (provider !== "ollama" && !entry.apiKey) problems.push(`Für ${LABELS[provider]} fehlt der API-Schlüssel.`);
  if (!entry.model) problems.push(`Für ${LABELS[provider]} ist kein Modell ausgewählt.`);
  return problems;
}

export async function saveAiSettings(body, userId) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const current = await readAiSettings();
  const next = { ...current, providers: { ...current.providers } };

  if (input.activeProvider !== undefined) {
    if (!AI_ACTIVE_VALUES.includes(input.activeProvider)) {
      throw badRequest("VALIDATION_ERROR", "Der KI-Anbieter ist ungültig.", { allowed: AI_ACTIVE_VALUES });
    }
    next.activeProvider = input.activeProvider;
  }

  if (input.timeoutMs !== undefined) {
    const timeoutMs = Number(input.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) {
      throw badRequest("VALIDATION_ERROR", "timeoutMs muss zwischen 5000 und 600000 liegen.");
    }
    next.timeoutMs = timeoutMs;
  }

  for (const provider of AI_PROVIDERS) {
    if (input.providers?.[provider]) {
      next.providers[provider] = mergeProviderInput(provider, next.providers[provider], input.providers[provider]);
    }
  }

  // Nur einen vollständig eingerichteten Anbieter aktivieren
  if (next.activeProvider !== "disabled") {
    const problems = providerProblems(next.activeProvider, next.providers[next.activeProvider]);
    if (problems.length) throw badRequest("AI_PROVIDER_INCOMPLETE", problems.join(" "));
  }

  await writeSetting(SETTING_KEY, toStored(next), userId);
  return publicAiSettings(next);
}

/** Aktiver, vollständig eingerichteter Anbieter – Grundlage für spätere KI-Funktionen. */
export function resolveAi(settings) {
  const provider = settings.activeProvider;
  if (provider === "disabled") return { enabled: false, provider, reason: "KI ist deaktiviert." };

  const entry = settings.providers[provider];
  const problems = providerProblems(provider, entry);
  if (problems.length) return { enabled: false, provider, reason: problems.join(" ") };

  return {
    enabled: true,
    provider,
    baseUrl: trimUrl(entry.baseUrl) || DEFAULT_BASE_URLS[provider],
    apiKey: entry.apiKey,
    model: entry.model,
    timeoutMs: settings.timeoutMs,
  };
}

function requestFor(provider, entry) {
  const baseUrl = trimUrl(entry.baseUrl) || DEFAULT_BASE_URLS[provider];

  if (provider === "claude") {
    return {
      url: `${baseUrl}/v1/models?limit=100`,
      headers: { "x-api-key": entry.apiKey, "anthropic-version": "2023-06-01" },
      models: (data) => (data.data || []).map((model) => model.id),
    };
  }
  if (provider === "openai") {
    // Auch OpenAI-kompatible Server (LM Studio, vLLM, LiteLLM …) liefern /models
    return {
      url: `${baseUrl}/models`,
      headers: entry.apiKey ? { Authorization: `Bearer ${entry.apiKey}` } : {},
      models: (data) => (data.data || []).map((model) => model.id).sort(),
    };
  }
  return {
    url: `${baseUrl}/api/tags`,
    // Optional, z. B. hinter einem Reverse-Proxy mit Token
    headers: entry.apiKey ? { Authorization: `Bearer ${entry.apiKey}` } : {},
    models: (data) => (data.models || []).map((model) => model.name).sort(),
  };
}

/**
 * Verbindung prüfen und verfügbare Modelle abrufen. Nicht gespeicherte Eingaben werden
 * mit dem gespeicherten Stand zusammengeführt, damit der Test ohne erneute Schlüsseleingabe geht.
 */
export async function testAiProvider(provider, candidate = {}, fetchImpl = fetch) {
  if (!AI_PROVIDERS.includes(provider)) {
    throw badRequest("VALIDATION_ERROR", "Der KI-Anbieter ist ungültig.", { allowed: AI_PROVIDERS });
  }

  const settings = await readAiSettings();
  const entry = mergeProviderInput(provider, settings.providers[provider], candidate);

  if (provider === "ollama" && !entry.baseUrl) {
    return { success: false, responseTimeMs: null, message: "Für Ollama fehlt die Serveradresse.", models: [] };
  }
  if (provider === "claude" && !entry.apiKey) {
    return { success: false, responseTimeMs: null, message: "Für Claude fehlt der API-Schlüssel.", models: [] };
  }

  const request = requestFor(provider, entry);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const started = Date.now();

  try {
    const response = await fetchImpl(request.url, {
      headers: { Accept: "application/json", "User-Agent": "Fahrtenbuch/1.0", ...request.headers },
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - started;

    if (response.status === 401 || response.status === 403) {
      return { success: false, responseTimeMs, message: "Der API-Schlüssel wurde abgelehnt.", models: [] };
    }
    if (!response.ok) {
      return { success: false, responseTimeMs, message: `Der Dienst antwortete mit HTTP ${response.status}.`, models: [] };
    }

    const models = request.models(await response.json());
    const modelMissing = entry.model && models.length && !models.includes(entry.model);

    return {
      success: true,
      responseTimeMs,
      message: modelMissing
        ? `Verbindung erfolgreich, das Modell „${entry.model}“ ist dort aber nicht verfügbar.`
        : `Verbindung erfolgreich – ${models.length} Modell(e) gefunden.`,
      models,
      // null = kein Modell eingetragen oder Liste leer
      modelAvailable: entry.model && models.length ? !modelMissing : null,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { success: false, responseTimeMs: null, message: "Der Dienst hat nicht rechtzeitig geantwortet.", models: [] };
    }
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return {
        success: false,
        responseTimeMs: null,
        message: error instanceof SyntaxError
          ? "Die Antwort war kein gültiges JSON – stimmt die Adresse?"
          : "Der Dienst ist nicht erreichbar. Bitte Adresse und Port prüfen.",
        models: [],
      };
    }
    throw serviceUnavailable("UPSTREAM_ERROR", String(error?.message || error));
  } finally {
    clearTimeout(timeout);
  }
}
