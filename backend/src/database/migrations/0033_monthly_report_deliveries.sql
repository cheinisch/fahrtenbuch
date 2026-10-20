-- Monatsbericht per E-Mail: ein Eintrag je Benutzer und Monat, damit der Worker jeden
-- Bericht genau einmal verschickt – auch bei mehreren Worker-Instanzen oder Neustarts.
CREATE TABLE IF NOT EXISTS monthly_report_deliveries (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_month date NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY (user_id, report_month)
);

ALTER TABLE monthly_report_deliveries
  DROP CONSTRAINT IF EXISTS monthly_report_deliveries_status_check;
ALTER TABLE monthly_report_deliveries
  ADD CONSTRAINT monthly_report_deliveries_status_check
  CHECK (status IN ('queued', 'sent', 'skipped', 'failed'));

ALTER TABLE monthly_report_deliveries
  DROP CONSTRAINT IF EXISTS monthly_report_deliveries_month_start;
ALTER TABLE monthly_report_deliveries
  ADD CONSTRAINT monthly_report_deliveries_month_start
  CHECK (report_month = date_trunc('month', report_month)::date);
