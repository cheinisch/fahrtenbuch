import { config } from "../config.js";
import { pool } from "../database/pool.js";
import { resolveTimeZone } from "../lib/timezone.js";
import { sendMonthlyReportMail } from "./mailService.js";
import { LOGO_CID, LOGO_PATH, mailLanguage, renderMonthlyReportMail } from "./monthlyReportMail.js";
import { buildMonthlyReport, localParts, previousMonth } from "./monthlyReportService.js";
import { isMailConfigured } from "./systemSettingsService.js";

// Versand ab 06:00 Uhr Ortszeit am Monatsersten. Lief der Worker da nicht (Wartung,
// Neustart), wird bis zum 7. nachgeholt – danach wäre der Bericht nicht mehr aktuell.
const SEND_HOUR = 6;
const CATCH_UP_DAYS = 7;

export function isReportDue(timeZone, now = new Date()) {
  const { day, hour } = localParts(timeZone, now);
  return day <= CATCH_UP_DAYS && (day > 1 || hour >= SEND_HOUR);
}

async function recipient(client, userId) {
  const result = await client.query(
    `
    SELECT u.id, u.email, u.display_name, u.first_name, u.username, u.locale,
      s.settings ->> 'language' AS language
    FROM users u
    LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE u.id = $1 AND u.deleted_at IS NULL
    `,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    email: row.email,
    name: row.first_name || row.display_name || row.username || "",
    language: mailLanguage(row.language || row.locale),
  };
}

/** Bericht bauen und senden. Ohne `force` wird ein leerer Monat nur vermerkt. */
export async function deliverMonthlyReport(userId, month, { force = false, client = pool } = {}) {
  const user = await recipient(client, userId);
  if (!user?.email) return { status: "skipped", reason: "NO_EMAIL" };
  const report = await buildMonthlyReport(userId, month, { client });
  if (report.isEmpty && !force) return { status: "skipped", reason: "EMPTY", report };
  const mail = renderMonthlyReportMail(report, { name: user.name, language: user.language, baseUrl: config.publicBaseUrl });
  await sendMonthlyReportMail({ to: user.email, ...mail, logoCid: LOGO_CID, logoPath: LOGO_PATH });
  return { status: "sent", to: user.email, report };
}

/** Job-Handler: Ergebnis im Versandprotokoll festhalten; Fehler gehen an die Warteschlange zurück. */
export async function runMonthlyReportJob({ userId, month }) {
  try {
    const result = await deliverMonthlyReport(userId, month);
    await pool.query(
      `UPDATE monthly_report_deliveries SET status = $3, error = NULL, sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END
       WHERE user_id = $1 AND report_month = $2::date`,
      [userId, `${month}-01`, result.status],
    );
  } catch (error) {
    await pool.query(
      `UPDATE monthly_report_deliveries SET status = 'failed', error = left($3, 1000) WHERE user_id = $1 AND report_month = $2::date`,
      [userId, `${month}-01`, String(error?.message || error)],
    ).catch(() => {});
    throw error;
  }
}

/** Fällige Berichte einreihen; jeder Benutzer und Monat höchstens einmal. */
export async function scheduleDueMonthlyReports(enqueue, now = new Date()) {
  if (!isMailConfigured()) return 0;
  const users = await pool.query(
    `
    SELECT u.id, u.timezone, u.created_at
    FROM users u
    LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE u.status = 'active' AND u.deleted_at IS NULL AND NULLIF(u.email, '') IS NOT NULL
      AND COALESCE(s.settings ->> 'monthlyReportEnabled', 'true') <> 'false'
    `,
  );
  let queued = 0;
  for (const user of users.rows) {
    const timeZone = resolveTimeZone(user.timezone);
    if (!isReportDue(timeZone, now)) continue;
    const month = previousMonth(timeZone, now);
    // Konten, die erst nach dem Berichtsmonat angelegt wurden, bekommen keinen Bericht
    const [y, m] = month.split("-").map(Number);
    if (new Date(user.created_at) >= new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1))) continue;
    const inserted = await pool.query(
      `INSERT INTO monthly_report_deliveries (user_id, report_month) VALUES ($1, $2::date)
       ON CONFLICT (user_id, report_month) DO NOTHING RETURNING user_id`,
      [user.id, `${month}-01`],
    );
    if (!inserted.rowCount) continue;
    await enqueue("report.monthly", { userId: user.id, month });
    queued += 1;
  }
  return queued;
}
