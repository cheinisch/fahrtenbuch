import assert from "node:assert/strict";
import { test } from "node:test";

// config.js verlangt diese Werte beim Import; eine Datenbank wird hier nicht angesprochen
process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { mergeProviderInput, normalize, providerProblems, publicAiSettings, resolveAi, toStored } = await import(
  "../src/services/aiSettingsService.js"
);

const empty = { baseUrl: "", apiKey: "", model: "" };

function settings(activeProvider, providers = {}) {
  return {
    activeProvider,
    timeoutMs: 60_000,
    providers: { claude: { ...empty }, openai: { ...empty }, ollama: { ...empty }, ...providers },
  };
}

test("leerer API-Schlüssel lässt den gespeicherten unverändert", () => {
  const current = { baseUrl: "", apiKey: "sk-alt-1234", model: "a" };
  assert.equal(mergeProviderInput("openai", current, { apiKey: "", model: "b" }).apiKey, "sk-alt-1234");
  assert.equal(mergeProviderInput("openai", current, { apiKey: "sk-neu" }).apiKey, "sk-neu");
  assert.equal(mergeProviderInput("openai", current, { clearApiKey: true }).apiKey, "");
});

test("Serveradresse wird geprüft und ohne Schrägstrich gespeichert", () => {
  assert.equal(mergeProviderInput("ollama", empty, { baseUrl: "http://gpu:11434/" }).baseUrl, "http://gpu:11434");
  assert.throws(() => mergeProviderInput("ollama", empty, { baseUrl: "gpu:11434" }), /http/);
});

test("Pflichtangaben je Anbieter", () => {
  assert.equal(providerProblems("ollama", { ...empty, model: "llama3" }).length, 1);
  assert.equal(providerProblems("ollama", { ...empty, baseUrl: "http://x", model: "llama3" }).length, 0);
  assert.equal(providerProblems("claude", { ...empty, model: "m" }).length, 1);
});

test("Admin-Sicht enthält nie den Schlüssel", () => {
  const view = publicAiSettings(settings("claude", { claude: { baseUrl: "", apiKey: "sk-ant-geheim-9876", model: "m" } }));
  assert.equal(JSON.stringify(view).includes("geheim"), false);
  assert.equal(view.providers.claude.apiKeySet, true);
  assert.equal(view.providers.claude.apiKeyHint, "…9876");
  assert.equal(view.providers.openai.apiKeySet, false);
});

test("aktiver Anbieter wird mit Standardadresse aufgelöst", () => {
  assert.equal(resolveAi(settings("disabled")).enabled, false);
  const ai = resolveAi(settings("openai", { openai: { baseUrl: "", apiKey: "sk", model: "m" } }));
  assert.equal(ai.enabled, true);
  assert.equal(ai.baseUrl, "https://api.openai.com/v1");
  assert.equal(resolveAi(settings("ollama")).enabled, false);
});

test("API-Schlüssel wird nur verschlüsselt gespeichert", () => {
  const stored = toStored(settings("claude", { claude: { baseUrl: "", apiKey: "sk-ant-geheim-9876", model: "m" } }));
  assert.equal(JSON.stringify(stored).includes("geheim"), false);
  assert.equal(stored.providers.openai.apiKeyEncrypted, null);
  assert.equal(normalize(stored).providers.claude.apiKey, "sk-ant-geheim-9876");
  // Unlesbarer Schlüssel gilt als nicht hinterlegt statt die Seite zu sprengen
  assert.equal(normalize({ providers: { claude: { apiKeyEncrypted: "kaputt" } } }).providers.claude.apiKey, "");
});
