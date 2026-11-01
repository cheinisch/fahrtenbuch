import { pool } from "../database/pool.js";
import { badRequest, notFound } from "../lib/errors.js";
import { resolveTimeZone } from "../lib/timezone.js";
import { localParts } from "./monthlyReportService.js";

export const REMINDER_FREQUENCIES = ["weekly", "monthly", "month_end"];
export const DEFAULT_REMINDER_SETTINGS = Object.freeze({
  enabled: false, frequency: "monthly", weekday: 1, dayOfMonth: 1, hour: 18,
});
// Eine Erinnerung gilt so lange als offen; danach ist sie nicht mehr aktuell
const OPEN_DAYS = 7;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 1 = Montag … 7 = Sonntag */
function isoWeekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

/**
 * Kalendertag (YYYY-MM-DD, Ortszeit), für den jetzt eine Erinnerung fällig ist, sonst null.
 * Fällig ab der eingestellten Stunde; der Worker prüft alle 15 Minuten, ein verpasster
 * Lauf wird also am selben Tag nachgeholt.
 */
export function reminderDueDate(settings, timeZone, now = new Date()) {
  if (!settings.enabled) return null;
  const { year, month, day, hour } = localParts(timeZone, now);
  if (hour < settings.hour) return null;
  const last = daysInMonth(year, month);
  let due = false;
  if (settings.frequency === "weekly") due = isoWeekday(year, month, day) === settings.weekday;
  else if (settings.frequency === "month_end") due = day === last;
  else due = day === Math.min(settings.dayOfMonth, last);
  if (!due) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function intField(value, name, min, max, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw badRequest("VALIDATION_ERROR", `${name} muss eine ganze Zahl von ${min} bis ${max} sein.`);
  }
  return number;
}

/** Eingabe prüfen; fehlende Felder behalten den bisherigen Wert. */
export function parseReminderSettings(body, current = DEFAULT_REMINDER_SETTINGS) {
  if (body == null || typeof body !== "object") throw badRequest("VALIDATION_ERROR", "Ungültige Eingabe.");
  if (body.enabled != null && typeof body.enabled !== "boolean") {
    throw badRequest("VALIDATION_ERROR", "enabled muss true oder false sein.");
  }
  const frequency = body.frequency ?? current.frequency;
  if (!REMINDER_FREQUENCIES.includes(frequency)) {
    throw badRequest("VALIDATION_ERROR", "frequency muss weekly, monthly oder month_end sein.");
  }
  return {
    enabled: body.enabled ?? current.enabled,
    frequency,
    weekday: intField(body.weekday, "weekday", 1, 7, current.weekday),
    dayOfMonth: intField(body.dayOfMonth, "dayOfMonth", 1, 28, current.dayOfMonth),
    hour: intField(body.hour, "hour", 0, 23, current.hour),
  };
}

function mapSettings(row) {
  if (!row) return { ...DEFAULT_REMINDER_SETTINGS };
  return {
    enabled: row.enabled, frequency: row.frequency, weekday: row.weekday,
    dayOfMonth: row.day_of_month, hour: row.hour,
  };
}

async function ownedVehicle(userId, vehicleId) {
  const result = await pool.query(
    `SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [vehicleId, userId],
  );
  if (!result.rowCount) throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
}

export async function getReminderSettings(userId, vehicleId) {
  await ownedVehicle(userId, vehicleId);
  const result = await pool.query(
    `SELECT * FROM vehicle_odometer_reminder_settings WHERE vehicle_id = $1 AND user_id = $2`,
    [vehicleId, userId],
  );
  return mapSettings(result.rows[0]);
}

export async function saveReminderSettings(userId, vehicleId, body) {
  const current = await getReminderSettings(userId, vehicleId);
  const next = parseReminderSettings(body, current);
  await pool.query(
    `INSERT INTO vehicle_odometer_reminder_settings
       (vehicle_id, user_id, enabled, frequency, weekday, day_of_month, hour, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (vehicle_id) DO UPDATE SET enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency,
       weekday = EXCLUDED.weekday, day_of_month = EXCLUDED.day_of_month, hour = EXCLUDED.hour, updated_at = now()`,
    [vehicleId, userId, next.enabled, next.frequency, next.weekday, next.dayOfMonth, next.hour],
  );
  return next;
}

/** Fällige Erinnerungen anlegen; je Fahrzeug und Tag höchstens eine. Liefert die Anzahl neuer. */
export async function scheduleDueOdometerReminders(now = new Date()) {
  const rows = await pool.query(
    `SELECT s.vehicle_id, s.user_id, s.enabled, s.frequency, s.weekday, s.day_of_month, s.hour, u.timezone
       FROM vehicle_odometer_reminder_settings s
       JOIN vehicles v ON v.id = s.vehicle_id AND v.user_id = s.user_id
       JOIN users u ON u.id = s.user_id
      WHERE s.enabled AND u.status = 'active' AND u.deleted_at IS NULL
        AND v.archived_at IS NULL AND v.deregistered_at IS NULL`,
  );
  let created = 0;
  for (const row of rows.rows) {
    const due = reminderDueDate(mapSettings(row), resolveTimeZone(row.timezone), now);
    if (!due) continue;
    // Wurde heute schon abgelesen, gibt es nichts zu erinnern
    const reading = await pool.query(
      `SELECT 1 FROM vehicle_odometer_readings WHERE user_id = $1 AND vehicle_id = $2 AND reading_date >= $3::date LIMIT 1`,
      [row.user_id, row.vehicle_id, due],
    );
    if (reading.rowCount) continue;
    const inserted = await pool.query(
      `INSERT INTO odometer_reminders (user_id, vehicle_id, due_date) VALUES ($1, $2, $3::date)
       ON CONFLICT (vehicle_id, due_date) DO NOTHING RETURNING id`,
      [row.user_id, row.vehicle_id, due],
    );
    created += inserted.rowCount;
  }
  return created;
}

/** Offene Erinnerungen; sobald ein Stand ab dem Fälligkeitstag eingetragen ist, entfallen sie. */
export async function pendingOdometerReminders(userId) {
  const result = await pool.query(
    `SELECT r.id, r.vehicle_id, v.name AS vehicle_name, v.license_plate,
            to_char(r.due_date, 'YYYY-MM-DD') AS due_date, r.created_at,
            last.odometer_meters AS last_odometer_meters
       FROM odometer_reminders r
       JOIN vehicles v ON v.id = r.vehicle_id AND v.user_id = r.user_id
       LEFT JOIN LATERAL (
         SELECT o.odometer_meters FROM vehicle_odometer_readings o
          WHERE o.user_id = r.user_id AND o.vehicle_id = r.vehicle_id
          ORDER BY o.reading_date DESC LIMIT 1
       ) last ON true
      WHERE r.user_id = $1 AND r.acknowledged_at IS NULL
        AND r.due_date >= current_date - $2::int
        AND v.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_odometer_readings o
           WHERE o.user_id = r.user_id AND o.vehicle_id = r.vehicle_id AND o.reading_date >= r.due_date)
      ORDER BY r.due_date, lower(v.name)`,
    [userId, OPEN_DAYS],
  );
  return result.rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicle_id,
    vehicleName: row.vehicle_name,
    licensePlate: row.license_plate,
    dueDate: row.due_date,
    lastOdometerKm: row.last_odometer_meters == null ? null : Number(row.last_odometer_meters) / 1000,
  }));
}

export async function acknowledgeOdometerReminder(userId, reminderId) {
  const result = await pool.query(
    `UPDATE odometer_reminders SET acknowledged_at = COALESCE(acknowledged_at, now())
      WHERE id = $1 AND user_id = $2 RETURNING id`,
    [reminderId, userId],
  );
  if (!result.rowCount) throw notFound("REMINDER_NOT_FOUND", "Die Erinnerung wurde nicht gefunden.");
}
