import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function initialState(vehicle) {
  return {
    name: vehicle?.name || "",
    manufacturer: vehicle?.manufacturer || "",
    model: vehicle?.model || "",
    licensePlate: vehicle?.licensePlate || "",
    vin: vehicle?.vin || "",
    odometerKm: vehicle?.odometerKm ?? "",
    color: vehicle?.color || "",
    bluetoothMac: vehicle?.bluetoothMac || "",
    notes: vehicle?.notes || "",
    isDefault: Boolean(vehicle?.isDefault),
  };
}

export default function VehicleEditorModal({
  open,
  vehicle,
  saving,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState(initialState(vehicle));
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(initialState(vehicle));
      setError("");
    }
  }, [open, vehicle]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!form.name.trim()) {
      setError("Bitte gib einen Fahrzeugnamen ein.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      licensePlate: form.licensePlate.trim() || null,
      vin: form.vin.trim() || null,
      odometerKm:
        form.odometerKm === "" ? null : Number(form.odometerKm),
      color: form.color.trim() || null,
      bluetoothMac: form.bluetoothMac.trim() || null,
      notes: form.notes.trim() || null,
      isDefault: form.isDefault,
    };

    try {
      await onSubmit(payload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Das Fahrzeug konnte nicht gespeichert werden.",
      );
    }
  }

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="w-full max-w-3xl overflow-hidden rounded-2xl border border-fb-border bg-fb-main shadow-2xl">
            <header className="flex items-start justify-between border-b border-fb-border px-5 py-4 sm:px-6">
              <div>
                <DialogTitle className="text-xl font-bold">
                  {vehicle ? "Fahrzeug bearbeiten" : "Fahrzeug anlegen"}
                </DialogTitle>
                <p className="mt-1 text-sm text-fb-muted">
                  Das Fahrzeug gehört ausschließlich zu deinem Benutzerkonto.
                </p>
              </div>
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-text disabled:opacity-50">
                <span className="sr-only">Schließen</span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <form onSubmit={submit}>
              <div className="space-y-5 p-5 sm:p-6">
                {error && <div className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{error}</div>}
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-medium">Fahrzeugname<input value={form.name} onChange={(e) => update("name", e.target.value)} required maxLength={120} className={fieldClass} placeholder="z. B. Golf" /></label>
                  <label className="text-sm font-medium">Kennzeichen<input value={form.licensePlate} onChange={(e) => update("licensePlate", e.target.value)} maxLength={64} className={fieldClass} placeholder="RÜD-AB 123" /></label>
                  <label className="text-sm font-medium">Hersteller<input value={form.manufacturer} onChange={(e) => update("manufacturer", e.target.value)} maxLength={120} className={fieldClass} /></label>
                  <label className="text-sm font-medium">Modell<input value={form.model} onChange={(e) => update("model", e.target.value)} maxLength={120} className={fieldClass} /></label>
                  <label className="text-sm font-medium">Kilometerstand<input type="number" min="0" step="0.1" value={form.odometerKm} onChange={(e) => update("odometerKm", e.target.value)} className={fieldClass} /></label>
                  <label className="text-sm font-medium">Farbe<input value={form.color} onChange={(e) => update("color", e.target.value)} maxLength={64} className={fieldClass} /></label>
                  <label className="text-sm font-medium">FIN / VIN<input value={form.vin} onChange={(e) => update("vin", e.target.value)} maxLength={64} className={fieldClass} /></label>
                  <label className="text-sm font-medium">Bluetooth-MAC<input value={form.bluetoothMac} onChange={(e) => update("bluetoothMac", e.target.value)} maxLength={64} className={fieldClass} placeholder="AA:BB:CC:DD:EE:FF" /></label>
                </div>
                <label className="block text-sm font-medium">Notizen<textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} className={fieldClass} /></label>
                <label className="flex items-start gap-3 rounded-lg border border-fb-border bg-fb-surface p-4">
                  <input type="checkbox" checked={form.isDefault} onChange={(e) => update("isDefault", e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
                  <span><span className="block text-sm font-semibold">Als Standardfahrzeug verwenden</span><span className="mt-1 block text-xs text-fb-muted">Neue Fahrten verwenden dieses Fahrzeug als Vorauswahl.</span></span>
                </label>
              </div>
              <footer className="flex justify-end gap-3 border-t border-fb-border bg-fb-surface px-5 py-4 sm:px-6">
                <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold">Abbrechen</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-60">{saving ? "Speichern …" : "Fahrzeug speichern"}</button>
              </footer>
            </form>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
