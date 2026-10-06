import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";

function formatDate(value) {
  if (!value) return "–";
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("de-DE").format(date)
    : "–";
}

function formatKm(value) {
  if (value == null) return "–";
  return `${Number(value).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`;
}

export default function OdometerReadingLogModal({ open, onClose, readings, vehicleName, onEdit }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/50" />
      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="w-full max-w-2xl rounded-xl border border-fb-border bg-fb-main shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-fb-border p-5">
              <div>
                <DialogTitle className="text-lg font-bold">Ableseprotokoll</DialogTitle>
                <p className="mt-1 text-sm text-fb-muted">{vehicleName || "Fahrzeug"} · {readings.length} {readings.length === 1 ? "Ablesung" : "Ablesungen"}</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-lg border border-fb-border px-3 py-2 text-sm hover:border-fb-accent">Schließen</button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {readings.length === 0 ? (
                <div className="p-8 text-center text-sm text-fb-muted">Noch keine Ablesungen vorhanden.</div>
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
                          <div className="font-semibold">{formatDate(reading.readingDate || `${reading.month}-01`)}</div>
                          <div className="mt-1 text-xs text-fb-muted">Quelle: {reading.source === "manual" ? "Manuell" : reading.source}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-bold">{formatKm(reading.odometerKm)}</div>
                          <div className="mt-1 text-xs text-fb-muted">Zum Bearbeiten auswählen</div>
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
