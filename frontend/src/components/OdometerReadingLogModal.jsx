import { useI18n } from "../i18n/I18nProvider.jsx";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";

function formatDate(value, locale) {
  if (!value) return "–";
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale).format(date)
    : "–";
}

function formatKm(value, locale) {
  if (value == null) return "–";
  return `${Number(value).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
}

export default function OdometerReadingLogModal({ open, onClose, readings, vehicleName, onEdit }) {
  const { t, locale }=useI18n();
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/50" />
      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="w-full max-w-2xl rounded-xl border border-fb-border bg-fb-main shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-fb-border p-5">
              <div>
                <DialogTitle className="text-lg font-bold">{t("odometer.readingLog")}</DialogTitle>
                <p className="mt-1 text-sm text-fb-muted">{vehicleName || t("odometer.vehicle")} · {readings.length} {readings.length === 1 ? t("odometer.reading") : t("odometer.readings")}</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-lg border border-fb-border px-3 py-2 text-sm hover:border-fb-accent">{t("odometer.close")}</button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {readings.length === 0 ? (
                <div className="p-8 text-center text-sm text-fb-muted">{t("odometer.empty")}</div>
              ) : (
                <ul className="divide-y divide-fb-border">
                  {readings.map((reading) => (
                    <li key={reading.id}>
                      <button
                        type="button"
                        onClick={() => { onEdit(reading); onClose(); }}
                        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-fb-surface"
                      >
                        <div>
                          <div className="font-semibold">{formatDate(reading.readingDate || `${reading.month}-01`, locale)}</div>
                          <div className="mt-1 text-xs text-fb-muted">{t("odometer.source")}: {reading.source === "manual" ? t("odometer.manual") : reading.source}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-bold">{formatKm(reading.odometerKm, locale)}</div>
                          <div className="mt-1 text-xs text-fb-muted">{t("odometer.selectEdit")}</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
