import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { askAi, buildPrompt, historyVote, parseAiAnswer, sameRoute } = await import("../src/services/tripClassificationService.js");

test("Historie: klare Mehrheit ab drei Fahrten", () => {
  assert.equal(historyVote([{ type: "business" }, { type: "business" }]), null);
  assert.deepEqual(historyVote([{ type: "business" }, { type: "business" }, { type: "business" }, { type: "private" }]),
    { type: "business", count: 3, total: 4, confidence: 0.75 });
  // 3 von 5 reicht nicht
  assert.equal(historyVote([{ type: "business" }, { type: "business" }, { type: "business" }, { type: "private" }, { type: "private" }]), null);
});

test("gleiche Strecke auch in Gegenrichtung", () => {
  const trip = { start_lat: 50, start_lon: 8, end_lat: 50.1, end_lon: 8.1 };
  assert.equal(sameRoute(trip, { start_lat: 50.001, start_lon: 8.001, end_lat: 50.1, end_lon: 8.1 }), true);
  assert.equal(sameRoute(trip, { start_lat: 50.1, start_lon: 8.1, end_lat: 50.0015, end_lon: 8 }), true);
  assert.equal(sameRoute(trip, { start_lat: 50, start_lon: 8, end_lat: 50.11, end_lon: 8.1 }), false);
});

test("KI-Antwort: JSON auch mit Text drumherum, unsicher = kein Typ", () => {
  assert.deepEqual(parseAiAnswer('Hier: {"type":"private","confidence":0.82,"reason":"Samstag, Baumarkt."} Fertig.'),
    { type: "private", confidence: 0.82, reason: "Samstag, Baumarkt." });
  assert.equal(parseAiAnswer('{"type":"business","confidence":0.4,"reason":"?"}').type, null);
  assert.equal(parseAiAnswer('{"type":"holiday","confidence":0.9}').type, null);
  assert.equal(parseAiAnswer("kein json"), null);
});

test("Prompt enthält Ziel, bekannten Ort, POI und Beispiele, aber keine Koordinaten", () => {
  const { system, user } = buildPrompt({
    startAddress: "Hauptstraße 1, Geisenheim", endAddress: "Industriestraße 5, Wiesbaden",
    startKnown: ["Zuhause"], endKnown: [], startPoi: null, endPoi: 'shop=doityourself "OBI"',
    when: "Sat 10:15 – 11:02", durationMinutes: 47, distanceKm: 23.4, vehicle: "Golf", purpose: null,
    examples: [{ type: "business", when: "Mon 08:12", start: "Zuhause", end: "Kunde GmbH" }],
  }, "de");
  assert.match(system, /German/);
  assert.match(user, /saved place: Zuhause/);
  assert.match(user, /doityourself/);
  assert.match(user, /business: Mon 08:12/);
  assert.doesNotMatch(user, /50\.\d{4}/);
});

function fakeFetch(reply, seen) {
  return async (url, options) => {
    seen.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => reply };
  };
}
const prompt = { system: "S", user: "U" };

test("Claude: Messages-API mit Schlüssel und Systemprompt", async () => {
  const seen = [];
  const text = await askAi({ provider: "claude", baseUrl: "https://api.anthropic.com", apiKey: "k", model: "m" }, prompt,
    fakeFetch({ content: [{ type: "text", text: "{}" }] }, seen));
  assert.equal(text, "{}");
  assert.equal(seen[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen[0].headers["x-api-key"], "k");
  assert.equal(seen[0].body.system, "S");
});

test("OpenAI: Chat Completions mit Bearer", async () => {
  const seen = [];
  const text = await askAi({ provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m" }, prompt,
    fakeFetch({ choices: [{ message: { content: "{\"a\":1}" } }] }, seen));
  assert.equal(text, "{\"a\":1}");
  assert.equal(seen[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(seen[0].headers.Authorization, "Bearer k");
  assert.equal(seen[0].body.messages[0].role, "system");
});

test("Ollama: /api/chat ohne Streaming im JSON-Modus", async () => {
  const seen = [];
  const text = await askAi({ provider: "ollama", baseUrl: "http://gpu:11434", apiKey: "", model: "llama3" }, prompt,
    fakeFetch({ message: { content: "{}" } }, seen));
  assert.equal(text, "{}");
  assert.equal(seen[0].url, "http://gpu:11434/api/chat");
  assert.equal(seen[0].body.stream, false);
  assert.equal(seen[0].body.format, "json");
  assert.equal(seen[0].headers.Authorization, undefined);
});

test("Fehler des Anbieters wird verständlich weitergegeben", async () => {
  const failing = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid x-api-key" } }) });
  await assert.rejects(askAi({ provider: "claude", baseUrl: "https://x", apiKey: "k", model: "m" }, prompt, failing), /invalid x-api-key/);
});
