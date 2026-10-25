// Umrechnung zwischen UTC-Zeitpunkten und Datum/Uhrzeit in einer IANA-Zeitzone,
// ohne zusätzliche Bibliothek. Damit zeigt der Fahrt-Editor die Zeiten in der
// Zeitzone der Fahrt, auch wenn der Browser in einer anderen Zone läuft.

function parts(date, timeZone) {
  const values = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)) {
    values[part.type] = part.value;
  }
  return values;
}

/** ISO-Zeitpunkt → { date: "YYYY-MM-DD", time: "HH:MM" } in der Zone. */
export function toZonedInput(value, timeZone) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  const p = parts(date, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function offsetMs(date, timeZone) {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Datum/Uhrzeit in der Zone → Date (UTC). Sekunden übernimmt keepSecondsFrom, damit
 * unveränderte Zeiten nicht auf volle Minuten springen.
 */
export function fromZonedInput(dateText, timeText, timeZone, keepSecondsFrom = null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText || "");
  const time = /^(\d{2}):(\d{2})$/.exec(timeText || "");
  if (!match || !time) return null;
  const seconds = keepSecondsFrom ? new Date(keepSecondsFrom).getUTCSeconds() : 0;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(time[1]), Number(time[2]), seconds);
  // Zweimal korrigieren, damit Sommer-/Winterzeitwechsel stimmen
  let guess = wall - offsetMs(new Date(wall), timeZone);
  guess = wall - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}
