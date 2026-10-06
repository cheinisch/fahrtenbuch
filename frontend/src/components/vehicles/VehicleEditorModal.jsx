import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";

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
    acquisitionType: vehicle?.acquisitionType || (vehicle?.isLeased ? "leasing" : "owned"),
    leaseStartDate: vehicle?.leaseStartDate?.slice?.(0, 10) || "",
    leaseEndDate: vehicle?.leaseEndDate?.slice?.(0, 10) || "",
    leaseIncludedKm: vehicle?.leaseIncludedKm ?? "",
  };
}

export default function VehicleEditorModal({
  open,
  vehicle,
  saving,
  onClose,
  onSubmit,
}) {
  const { t } = useI18n();
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
      setError(t("vehicleEditor.nameRequired"));
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
      acquisitionType: form.acquisitionType,
      leaseStartDate: form.acquisitionType !== "owned" && form.leaseStartDate ? form.leaseStartDate : null,
      leaseEndDate: form.acquisitionType !== "owned" && form.leaseEndDate ? form.leaseEndDate : null,
      leaseIncludedKm: form.acquisitionType !== "owned" && form.leaseIncludedKm !== "" ? Number(form.leaseIncludedKm) : null,
    };

    const contractStarted = form.acquisitionType !== "owned" && (form.leaseStartDate || form.leaseEndDate || form.leaseIncludedKm !== "");
    if (contractStarted && (!form.leaseStartDate || !form.leaseEndDate || !payload.leaseIncludedKm)) {
      setError(t("vehicleEditor.contractIncomplete"));
      return;
    }
    if (contractStarted && form.leaseEndDate <= form.leaseStartDate) {
      setError("Das {t("vehicleEditor.contractEnd")} muss nach dem {t("vehicleEditor.contractStart")} liegen.");
      return;
    }

    try {
      await onSubmit(payload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("vehicleEditor.saveFailed"),
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
                  {vehicle ? t("vehicleEditor.edit") : t("vehicleEditor.create")}
                </DialogTitle>
                <p className="mt-1 text-sm text-fb-muted">
                  {t("vehicleEditor.ownerHint")}
                </p>
              </div>
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-text disabled:opacity-50">
                <span className="sr-only">{t("common.close")}</span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <form onSubmit={submit}>
              <div className="space-y-5 p-5 sm:p-6">
                {error && <div className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{error}</div>}
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-medium">{t("vehicleEditor.name")}<input value={form.name} onChange={(e) => update("name", e.target.value)} required maxLength={120} className={fieldClass} placeholder="z. B. Golf" /></label>
                  <label className="text-sm font-medium">{t("vehicleEditor.plate")}<input value={form.licensePlate} onChange={(e) => update("licensePlate", e.target.value)} maxLength={64} className={fieldClass} placeholder="RÜD-AB 123" /></label>
                  <label className="text-sm font-medium">{t("vehicleEditor.manufacturer")}<input value={form.manufacturer} onChange={(e) => update("manufacturer", e.target.value)} maxLength={120} className={fieldClass} /></label>
                  <label className="text-sm font-medium">{t("vehicleEditor.model")}<input value={form.model} onChange={(e) => update("model", e.target.value)} maxLength={120} className={fieldClass} /></label>
                  <label className="text-sm font-medium">{t("vehicleEditor.odometer")}<input type="number" min="0" step="0.1" value={form.odometerKm} onChange={(e) => update("odometerKm", e.target.value)} className={fieldClass} /></label>
                  <label className="text-sm font-medium">{t("vehicleEditor.color")}<input value={form.color} onChange={(e) => update("color", e.target.value)} maxLength={64} className={fieldClass} /></label>
                  <label className="text-sm font-medium">FIN / VIN<input value={form.vin} onChange={(e) => update("vin", e.target.value)} maxLength={64} className={fieldClass} /></label>
                  <label className="text-sm font-medium">{t("vehicleEditor.bluetooth")}<input value={form.bluetoothMac} onChange={(e) => update("bluetoothMac", e.target.value)} maxLength={64} className={fieldClass} placeholder="AA:BB:CC:DD:EE:FF" /></label>
                </div>
                <div className="rounded-xl border border-fb-border bg-fb-surface p-4">
                  <label className="block text-sm font-semibold">{t("vehicleEditor.acquisition")}
                    <select value={form.acquisitionType} onChange={(e) => update("acquisitionType", e.target.value)} className={fieldClass}>
                      <option value="owned">Eigentum / keine Finanzierung</option>
                      <option value="leasing">Leasing</option>
                      <option value="financing">Finanzierung</option>
                    </select>
                  </label>
                  {form.acquisitionType !== "owned" && <>
                    <p className="mt-3 text-xs text-fb-muted">{t("vehicleEditor.contractHint")}</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <label className="text-sm font-medium">{t("vehicleEditor.contractStart")}<input type="date" value={form.leaseStartDate} onChange={(e) => update("leaseStartDate", e.target.value)} className={fieldClass} /></label>
                      <label className="text-sm font-medium">{t("vehicleEditor.contractEnd")}<input type="date" value={form.leaseEndDate} min={form.leaseStartDate || undefined} onChange={(e) => update("leaseEndDate", e.target.value)} className={fieldClass} /></label>
                      <label className="text-sm font-medium">{t("vehicleEditor.kmLimit")}<input type="number" min="1" step="1" value={form.leaseIncludedKm} onChange={(e) => update("leaseIncludedKm", e.target.value)} className={fieldClass} placeholder="z. B. 60000" /></label>
                    </div>
                  </>}
                </div>
                <label className="block text-sm font-medium">{t("vehicleEditor.notes")}<textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} className={fieldClass} /></label>
                <label className="flex items-start gap-3 rounded-lg border border-fb-border bg-fb-surface p-4">
                  <input type="checkbox" checked={form.isDefault} onChange={(e) => update("isDefault", e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
                  <span><span className="block text-sm font-semibold">{t("vehicleEditor.default")}</span><span className="mt-1 block text-xs text-fb-muted">{t("vehicleEditor.defaultHint")}</span></span>
                </label>
              </div>
              <footer className="flex justify-end gap-3 border-t border-fb-border bg-fb-surface px-5 py-4 sm:px-6">
                <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold">{t("common.cancel")}</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-60">{saving ? t("common.saving") : t("vehicleEditor.save")}</button>
              </footer>
            </form>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
