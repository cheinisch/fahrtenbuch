import { config } from "../config.js";
import { pool } from "../database/pool.js";
import { haversineDistance } from "../lib/geo.js";
import { formatInTimeZone, resolveTimeZone } from "../lib/timezone.js";
import { readAiSettings, resolveAi } from "./aiSettingsService.js";
import { photonReverse } from "./geocodingService.js";
import { getOwnedTrip } from "./tripService.js";
import { getLocationSuggestions, loadKnownLocations, locationsNear } from "./tripSuggestionService.js";

/*
 * Vorschläge zur Fahrtart in zwei Stufen:
 * 1. Historie: gleiche Strecke (Start und Ziel je im Umkreis, auch in Gegenrichtung) wurde schon
 *    mehrfach gleich eingeordnet → kein KI-Aufruf nötig, nachvollziehbar, kostenlos.
 * 2. KI (Claude, OpenAI, Ollama) für den Rest – nur mit Zustimmung des Nutzers im Profil.
 * Beides sind nur Vorschläge; eingeordnet wird erst, wenn der Nutzer bestätigt.
 */

export const CLASSIFICATION_TYPES = ["business", "private", "commute"];

// Historie: Start und Ziel je in diesem Umkreis gelten als „gleiche Strecke“
const HISTORY_RADIUS_METERS = 300;
const HISTORY_MIN_TRIPS = 3;
const HISTORY_MIN_SHARE = 0.75;
// Darunter zeigt die Oberfläche keinen KI-Vorschlag
export const AI_MIN_CONFIDENCE = 0.6;
// So viele eigene, bereits eingeordnete Fahrten bekommt die KI als Beispiele
const AI_EXAMPLES = 12;

const TYPE_LABELS_DE = { business: "Dienstfahrten", private: "Privatfahrten", commute: "Arbeitswege" };

// ---------- Stufe 1: Historie ----------

/** Mehrheitsentscheid über gleiche Strecken. rows: [{ type }] */
export function historyVote(rows) {
  const total = rows.length;
  if (total < HISTORY_MIN_TRIPS) return null;
  const counts = new Map();
  for (const row of rows) counts.set(row.type, (counts.get(row.type) || 0) + 1);
  const [type, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = count / total;
  if (share < HISTORY_MIN_SHARE) return null;
  return { type, count, total, confidence: Math.round(share * 1000) / 1000 };
}

/** Liegt eine frühere Fahrt auf derselben Strecke (oder in Gegenrichtung)? */
export function sameRoute(trip, other, radius = HISTORY_RADIUS_METERS) {
  const point = (lat, lon) => ({ lat: Number(lat), lon: Number(lon) });
  const near = (a, b) => haversineDistance(a, b) <= radius;
  const start = point(trip.start_lat, trip.start_lon);
  const end = point(trip.end_lat, trip.end_lon);
  const otherStart = point(other.start_lat, other.start_lon);
  const otherEnd = point(other.end_lat, other.end_lon);
  return (near(start, otherStart) && near(end, otherEnd)) || (near(start, otherEnd) && near(end, otherStart));
}

export async function historySuggestion(userId, trip, client = pool) {
  if ([trip.start_lat, trip.start_lon, trip.end_lat, trip.end_lon].some((value) => value == null)) return null;
  // Grobe Vorauswahl per Rechteck (nutzt Indizes), genaue Prüfung danach in JS
  const dLat = HISTORY_RADIUS_METERS / 111_000;
  const box = (lat, lon) => {
    const dLon = dLat / Math.max(0.2, Math.cos((Number(lat) * Math.PI) / 180));
    return [Number(lat) - dLat, Number(lat) + dLat, Number(lon) - dLon, Number(lon) + dLon];
  };
  const [s1, s2, s3, s4] = box(trip.start_lat, trip.start_lon);
  const [e1, e2, e3, e4] = box(trip.end_lat, trip.end_lon);
  const result = await client.query(
    `SELECT type, start_lat, start_lon, end_lat, end_lon
       FROM trips
      WHERE user_id = $1 AND id <> $2 AND archived_at IS NULL AND status = 'completed'
        AND type IN ('business', 'private', 'commute')
        AND (
          (start_lat BETWEEN $3 AND $4 AND start_lon BETWEEN $5 AND $6 AND end_lat BETWEEN $7 AND $8 AND end_lon BETWEEN $9 AND $10)
          OR (start_lat BETWEEN $7 AND $8 AND start_lon BETWEEN $9 AND $10 AND end_lat BETWEEN $3 AND $4 AND end_lon BETWEEN $5 AND $6)
        )
      ORDER BY started_at DESC
      LIMIT 100`,
    [userId, trip.id, s1, s2, s3, s4, e1, e2, e3, e4],
  );
  const vote = historyVote(result.rows.filter((row) => sameRoute(trip, row)));
  if (!vote) return null;
  return {
    type: vote.type,
    source: "history",
    confidence: vote.confidence,
    historyCount: vote.count,
    historyTotal: vote.total,
    reason: `${vote.count} von ${vote.total} Fahrten auf dieser Strecke waren ${TYPE_LABELS_DE[vote.type]}.`,
  };
}

// ---------- Stufe 2: KI ----------

function describePoi(result) {
  const raw = result?.raw || {};
  // Straßen und Ortsnamen sagen nichts über den Zweck aus
  if (!raw.osm_key || ["highway", "place", "boundary"].includes(raw.osm_key)) return null;
  return `${raw.osm_key}=${raw.osm_value}${raw.name ? ` "${raw.name}"` : ""}`;
}

async function poiAt(lat, lon, language) {
  if (lat == null || lon == null) return null;
  try {
    return describePoi((await photonReverse(Number(lat), Number(lon), language)).result);
  } catch {
    return null;
  }
}

function localTime(value, zone, options) {
  return value ? formatInTimeZone(value, zone, "en-GB", options) : "?";
}

/** Sachlicher Kontext für die KI – nur Adressen und Eckdaten, keine GPS-Spur. */
export function buildPrompt(context, language = "de") {
  const languageName = language === "en" ? "English" : "German";
  const system = [
    "You help classify trips in a German mileage logbook (Fahrtenbuch).",
    "Categories: business (trip for work: customers, suppliers, business errands, other work sites),",
    "private (personal trip: shopping, leisure, visiting friends, doctor), commute (between home and the regular workplace).",
    "Use the destination and its point of interest, weekday, time, and the user's earlier decisions on similar destinations.",
    "If the information does not make one category clearly more likely, answer type null. Never guess wildly.",
    `Reply with JSON only: {"type": "business" | "private" | "commute" | null, "confidence": number between 0 and 1, "reason": "one short sentence in ${languageName}"}`,
  ].join(" ");

  const place = (label, address, known, poi) => {
    const parts = [`${label}: ${address || "unknown address"}`];
    if (known.length) parts.push(`(user's saved place: ${known.join(", ")})`);
    if (poi) parts.push(`[point of interest: ${poi}]`);
    return `- ${parts.join(" ")}`;
  };
  const lines = [
    "Trip to classify:",
    place("Start", context.startAddress, context.startKnown, context.startPoi),
    place("Destination", context.endAddress, context.endKnown, context.endPoi),
    `- Local time: ${context.when}, duration ${context.durationMinutes} min, distance ${context.distanceKm} km`,
  ];
  if (context.vehicle) lines.push(`- Vehicle: ${context.vehicle}`);
  if (context.purpose) lines.push(`- Purpose noted by the user: ${context.purpose}`);
  if (context.examples.length) {
    lines.push("", "The user's earlier classified trips (most recent first):");
    for (const example of context.examples) {
      lines.push(`- ${example.type}: ${example.when}, ${example.start || "?"} -> ${example.end || "?"}`);
    }
  }
  return { system, user: lines.join("\n") };
}

/** Antwort der KI lesen; tolerant gegenüber Text um das JSON herum. */
export function parseAiAnswer(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const confidence = Math.min(1, Math.max(0, Number(data.confidence)));
  const type = CLASSIFICATION_TYPES.includes(data.type) && Number.isFinite(confidence) && confidence >= AI_MIN_CONFIDENCE
    ? data.type
    : null;
  return {
    type,
    confidence: Number.isFinite(confidence) ? Math.round(confidence * 1000) / 1000 : null,
    reason: String(data.reason || "").trim().slice(0, 300) || null,
  };
}

/** Eine Anfrage an den eingestellten Anbieter; liefert den Antworttext. */
export async function askAi(ai, { system, user }, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ai.timeoutMs || 60_000);
  const post = async (url, headers, body) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Fahrtenbuch/1.0", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(`KI-Anbieter: ${typeof detail === "string" ? detail : `HTTP ${response.status}`}`);
    }
    return data;
  };

  try {
    if (ai.provider === "claude") {
      const data = await post(`${ai.baseUrl}/v1/messages`, { "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01" }, {
        model: ai.model,
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: user }],
      });
      return (data?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("");
    }
    if (ai.provider === "openai") {
      const data = await post(`${ai.baseUrl}/chat/completions`, ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}, {
        model: ai.model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      });
      return data?.choices?.[0]?.message?.content || "";
    }
    const data = await post(`${ai.baseUrl}/api/chat`, ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}, {
      model: ai.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      stream: false,
      format: "json",
    });
    return data?.message?.content || "";
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Der KI-Anbieter hat nicht rechtzeitig geantwortet.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function userAiState(userId, client = pool) {
  if (!config.features.aiClassification) return { available: false, enabled: false, ai: null, language: "de" };
  const [aiSettings, settings] = await Promise.all([
    readAiSettings(client),
    client.query(`SELECT settings FROM user_settings WHERE user_id = $1`, [userId]),
  ]);
  const ai = resolveAi(aiSettings);
  const custom = settings.rows[0]?.settings || {};
  return {
    available: ai.enabled,
    enabled: ai.enabled && custom.aiClassificationEnabled === true,
    ai: ai.enabled ? ai : null,
    language: custom.language === "en" ? "en" : "de",
  };
}

async function buildContext(userId, trip, language, client = pool) {
  const zone = resolveTimeZone(trip.start_timezone, trip.user_timezone);
  const known = await loadKnownLocations(userId);
  const [startPoi, endPoi, examples] = await Promise.all([
    poiAt(trip.start_lat, trip.start_lon, language),
    poiAt(trip.end_lat, trip.end_lon, language),
    client.query(
      `SELECT type, start_address, end_address, started_at, COALESCE(start_timezone, $3::text) AS zone
         FROM trips
        WHERE user_id = $1 AND id <> $2 AND archived_at IS NULL AND status = 'completed'
          AND type IN ('business', 'private', 'commute')
        ORDER BY started_at DESC
        LIMIT ${AI_EXAMPLES}`,
      [userId, trip.id, zone],
    ),
  ]);
  const whenOptions = { weekday: "short", hour: "2-digit", minute: "2-digit" };
  const started = trip.started_at ? new Date(trip.started_at) : null;
  const ended = trip.ended_at ? new Date(trip.ended_at) : null;
  return {
    startAddress: trip.start_address,
    endAddress: trip.end_address,
    startKnown: locationsNear(trip.start_lat, trip.start_lon, known).map((location) => location.name),
    endKnown: locationsNear(trip.end_lat, trip.end_lon, known).map((location) => location.name),
    startPoi,
    endPoi,
    when: `${localTime(started, zone, whenOptions)} – ${localTime(ended, zone, { hour: "2-digit", minute: "2-digit" })}`,
    durationMinutes: started && ended ? Math.round((ended - started) / 60_000) : "?",
    distanceKm: Math.round(Number(trip.distance_meters || 0) / 100) / 10,
    vehicle: trip.vehicle_name || null,
    purpose: trip.purpose || null,
    examples: examples.rows.map((row) => ({
      type: row.type,
      when: localTime(row.started_at, resolveTimeZone(row.zone), whenOptions),
      start: row.start_address,
      end: row.end_address,
    })),
  };
}

/**
 * KI-Vorschlag für eine Fahrt erzeugen und speichern.
 * Ohne force nur für offene Fahrten ohne bisherigen Vorschlag und ohne eindeutige Historie
 * (spart Aufrufe); mit force (Button „KI fragen“) auch erneut.
 */
export async function generateAiSuggestion(userId, tripId, { force = false, fetchImpl = fetch } = {}) {
  const state = await userAiState(userId);
  if (!state.available) return { status: "unavailable" };
  if (!state.enabled) return { status: "disabledByUser" };

  const trip = await getOwnedTrip(pool, userId, tripId, { includeTags: false });
  if (!trip || trip.archived_at || trip.status !== "completed") return { status: "skipped" };

  if (!force) {
    if (trip.type !== "unclassified") return { status: "skipped" };
    const existing = await pool.query(`SELECT 1 FROM trip_ai_suggestions WHERE trip_id = $1`, [tripId]);
    if (existing.rowCount) return { status: "exists" };
    if (await historySuggestion(userId, trip)) return { status: "history" };
  }

  const context = await buildContext(userId, trip, state.language);
  const answer = parseAiAnswer(await askAi(state.ai, buildPrompt(context, state.language), fetchImpl));
  if (!answer) throw new Error("Die Antwort der KI war nicht lesbar.");

  await pool.query(
    `INSERT INTO trip_ai_suggestions (trip_id, user_id, type, confidence, reason, provider, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (trip_id) DO UPDATE SET
       type = EXCLUDED.type, confidence = EXCLUDED.confidence, reason = EXCLUDED.reason,
       provider = EXCLUDED.provider, model = EXCLUDED.model, created_at = now(), dismissed_at = NULL`,
    [tripId, userId, answer.type, answer.confidence, answer.reason, state.ai.provider, state.ai.model],
  );
  return { status: answer.type ? "created" : "uncertain", suggestion: answer };
}

export async function dismissAiSuggestion(userId, tripId) {
  await pool.query(
    `UPDATE trip_ai_suggestions SET dismissed_at = now() WHERE trip_id = $1 AND user_id = $2`,
    [tripId, userId],
  );
}

/** Alle Vorschläge einer Fahrt: bekannte Orte, Historie, gespeicherter KI-Vorschlag. */
export async function getTripSuggestions(userId, trip) {
  const suggestions = await getLocationSuggestions(userId, trip);
  if (!config.features.aiClassification) return { suggestions };

  const [history, stored, state] = await Promise.all([
    historySuggestion(userId, trip),
    pool.query(`SELECT * FROM trip_ai_suggestions WHERE trip_id = $1 AND user_id = $2`, [trip.id, userId]),
    userAiState(userId),
  ]);
  const has = (type) => suggestions.some((suggestion) => suggestion.type === type);
  if (history && !has(history.type)) suggestions.push(history);

  const row = stored.rows[0];
  if (row?.type && !row.dismissed_at && !has(row.type)) {
    suggestions.push({
      type: row.type,
      source: "ai",
      confidence: row.confidence == null ? null : Number(row.confidence),
      reason: row.reason,
      provider: row.provider,
    });
  }

  return {
    suggestions,
    ai: {
      available: state.available,
      enabled: state.enabled,
      // uncertain: KI wurde gefragt, war sich aber nicht sicher; dismissed: Nutzer hat verworfen
      status: !row ? "none" : row.dismissed_at ? "dismissed" : row.type ? "suggested" : "uncertain",
    },
  };
}

// Reihenfolge beim Bündeln: feste Regeln vor Historie vor KI
const SOURCE_RANK = { places: 0, history: 1, ai: 2 };

/** Bester Vorschlag je offener Fahrt (z. B. Monatsbericht in der Web-App). */
export async function bestSuggestions(userId, tripIds) {
  const result = {};
  for (const tripId of tripIds) {
    const trip = await getOwnedTrip(pool, userId, tripId, { includeTags: false });
    if (!trip) continue;
    const { suggestions } = await getTripSuggestions(userId, trip);
    const best = [...suggestions].sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9))[0];
    if (best) {
      result[tripId] = {
        type: best.type,
        source: best.source || "places",
        confidence: best.confidence ?? null,
        reason: best.reason || null,
        historyCount: best.historyCount,
        historyTotal: best.historyTotal,
        provider: best.provider,
      };
    }
  }
  return result;
}
