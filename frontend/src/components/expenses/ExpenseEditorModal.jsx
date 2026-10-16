import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";

export const ENERGY_CATEGORIES = ["fuel", "charging"];
export const OTHER_CATEGORIES = [
  "insurance", "tax", "maintenance", "inspection", "repair", "tires",
  "leasing", "financing", "parking", "toll", "cleaning", "other",
];
const FUEL_TYPES = ["petrol", "diesel", "lpg", "cng", "hydrogen", "other"];

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function today() {
  // Lokales Kalenderdatum, nicht UTC (sonst kurz nach Mitternacht der Vortag)
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function initialState(expense, mode, vehicleId) {
  const energy = expense ? ENERGY_CATEGORIES.includes(expense.category) : mode === "energy";
  return {
    vehicleId: expense?.vehicleId || vehicleId || "",
    category: expense?.category || (energy ? "fuel" : "maintenance"),
    date: expense?.date || today(),
    amount: expense?.amount ?? "",
    currency: expense?.currency || "EUR",
    odometerKm: expense?.odometerKm ?? "",
    quantity: expense?.quantity ?? "",
    quantityUnit: expense?.quantityUnit || "l",
    fuelType: expense?.fuelType && expense.fuelType !== "electric" ? expense.fuelType : "",
    fullTank: expense ? Boolean(expense.fullTank) : true,
    usePeriod: Boolean(expense?.periodStart),
    periodStart: expense?.periodStart || "",
    periodEnd: expense?.periodEnd || "",
    vendor: expense?.vendor || "",
    notes: expense?.notes || "",
  };
}

export default function ExpenseEditorModal({
  open,
  expense,
  mode,
  vehicles,
  defaultVehicleId,
  saving,
  onClose,
  onSubmit,
}) {
  const { t, number } = useI18n();
  const [form, setForm] = useState(() => initialState(expense, mode, defaultVehicleId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(initialState(expense, mode, defaultVehicleId));
      setError("");
    }
  }, [open, expense, mode, defaultVehicleId]);

  const isEnergy = ENERGY_CATEGORIES.includes(form.category);
  const unit = form.category === "charging" ? "kwh" : form.quantityUnit;
  const pricePerUnit = Number(form.amount) > 0 && Number(form.quantity) > 0
    ? Number(form.amount) / Number(form.quantity)
    : null;

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!form.vehicleId) {
      setError(t("expenses.editor.vehicleRequired"));
      return;
    }
    if (form.amount === "" || Number(form.amount) < 0) {
      setError(t("expenses.editor.amountRequired"));
      return;
    }
    if (!isEnergy && form.usePeriod) {
      if (!form.periodStart || !form.periodEnd) {
        setError(t("expenses.editor.periodIncomplete"));
        return;
      }
      if (form.periodEnd < form.periodStart) {
        setError(t("expenses.editor.periodOrder"));
        return;
      }
    }

    const payload = {
      vehicleId: form.vehicleId,
      category: form.category,
      date: form.date,
      amount: Number(form.amount),
      currency: form.currency.trim().toUpperCase() || "EUR",
      odometerKm: form.odometerKm === "" ? null : Number(form.odometerKm),
      vendor: form.vendor.trim() || null,
      notes: form.notes.trim() || null,
      periodStart: !isEnergy && form.usePeriod ? form.periodStart : null,
      periodEnd: !isEnergy && form.usePeriod ? form.periodEnd : null,
    };
    if (isEnergy) {
      payload.quantity = form.quantity === "" ? null : Number(form.quantity);
      payload.quantityUnit = payload.quantity == null ? null : unit;
      payload.fuelType = form.category === "charging" ? "electric" : form.fuelType || null;
      payload.fullTank = form.fullTank;
    }

    try {
      await onSubmit(payload);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("expenses.editor.saveFailed"));
    }
  }

  const title = expense
    ? t("expenses.editor.edit")
    : isEnergy ? t("expenses.editor.createEnergy") : t("expenses.editor.createOther");

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="w-full max-w-2xl overflow-hidden rounded-2xl border border-fb-border bg-fb-main shadow-2xl">
            <header className="flex items-start justify-between border-b border-fb-border px-5 py-4 sm:px-6">
              <div>
                <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
                <p className="mt-1 text-sm text-fb-muted">
                  {isEnergy ? t("expenses.editor.energyHint") : t("expenses.editor.otherHint")}
                </p>
              </div>
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-text disabled:opacity-50">
                <span className="sr-only">{t("common.close")}</span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <form onSubmit={submit}>
              <div className="space-y-5 p-5 sm:p-6">
                {error && <div role="alert" className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{error}</div>}

                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-medium">{t("expenses.vehicle")}
                    <select value={form.vehicleId} onChange={(e) => update("vehicleId", e.target.value)} required className={fieldClass}>
                      <option value="" disabled>{t("expenses.editor.chooseVehicle")}</option>
                      {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}{vehicle.licensePlate ? ` (${vehicle.licensePlate})` : ""}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">{t("expenses.category")}
                    <select value={form.category} onChange={(e) => update("category", e.target.value)} className={fieldClass}>
                      {(isEnergy ? ENERGY_CATEGORIES : OTHER_CATEGORIES).map((category) => (
                        <option key={category} value={category}>{t(`expenses.categories.${category}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium">{t("expenses.date")}
                    <input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} required className={fieldClass} />
                  </label>
                  <div className="grid grid-cols-[1fr_88px] gap-3">
                    <label className="text-sm font-medium">{t("expenses.amount")}
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => update("amount", e.target.value)} required className={fieldClass} placeholder="0,00" />
                    </label>
                    <label className="text-sm font-medium">{t("expenses.currency")}
                      <input value={form.currency} onChange={(e) => update("currency", e.target.value)} maxLength={3} className={`${fieldClass} uppercase`} />
                    </label>
                  </div>
                </div>

                {isEnergy ? (
                  <div className="rounded-xl border border-fb-border bg-fb-surface p-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="text-sm font-medium">{t("expenses.quantity")}
                        <div className="mt-2 flex">
                          <input type="number" min="0.001" step="0.01" inputMode="decimal" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} className="block w-full min-w-0 rounded-l-lg border border-fb-border bg-fb-main px-3 py-2.5 text-sm text-fb-text outline-none focus:border-fb-accent" />
                          {form.category === "charging" ? (
                            <span className="flex items-center rounded-r-lg border border-l-0 border-fb-border px-3 text-sm text-fb-muted">kWh</span>
                          ) : (
                            <select aria-label={t("expenses.unit")} value={form.quantityUnit} onChange={(e) => update("quantityUnit", e.target.value)} className="rounded-r-lg border border-l-0 border-fb-border bg-fb-main px-2 text-sm">
                              <option value="l">l</option>
                              <option value="kg">kg</option>
                            </select>
                          )}
                        </div>
                      </label>
                      <label className="text-sm font-medium">{t("expenses.odometer")}
                        <input type="number" min="0" step="0.1" value={form.odometerKm} onChange={(e) => update("odometerKm", e.target.value)} className={fieldClass} />
                      </label>
                      {form.category === "fuel" ? (
                        <label className="text-sm font-medium">{t("expenses.fuelType")}
                          <select value={form.fuelType} onChange={(e) => update("fuelType", e.target.value)} className={fieldClass}>
                            <option value="">–</option>
                            {FUEL_TYPES.map((type) => <option key={type} value={type}>{t(`expenses.fuelTypes.${type}`)}</option>)}
                          </select>
                        </label>
                      ) : <div />}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-3 text-sm">
                        <input type="checkbox" checked={form.fullTank} onChange={(e) => update("fullTank", e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                        <span><span className="font-semibold">{form.category === "charging" ? t("expenses.fullCharge") : t("expenses.fullTank")}</span><span className="block text-xs text-fb-muted">{t("expenses.editor.fullTankHint")}</span></span>
                      </label>
                      {pricePerUnit != null && (
                        <p className="text-sm text-fb-muted">
                          {t("expenses.pricePerUnit")}: <span className="font-semibold text-fb-text">{number(pricePerUnit, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} {form.currency || "EUR"}/{t(`expenses.units.${unit}`)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-fb-border bg-fb-surface p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium">{t("expenses.odometerOptional")}
                        <input type="number" min="0" step="0.1" value={form.odometerKm} onChange={(e) => update("odometerKm", e.target.value)} className={fieldClass} />
                      </label>
                    </div>
                    <label className="mt-4 flex items-start gap-3 text-sm">
                      <input type="checkbox" checked={form.usePeriod} onChange={(e) => update("usePeriod", e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
                      <span><span className="font-semibold">{t("expenses.editor.usePeriod")}</span><span className="block text-xs text-fb-muted">{t("expenses.editor.periodHint")}</span></span>
                    </label>
                    {form.usePeriod && (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="text-sm font-medium">{t("expenses.periodStart")}
                          <input type="date" value={form.periodStart} onChange={(e) => update("periodStart", e.target.value)} className={fieldClass} />
                        </label>
                        <label className="text-sm font-medium">{t("expenses.periodEnd")}
                          <input type="date" value={form.periodEnd} min={form.periodStart || undefined} onChange={(e) => update("periodEnd", e.target.value)} className={fieldClass} />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-medium">{isEnergy ? t("expenses.station") : t("expenses.vendor")}
                    <input value={form.vendor} onChange={(e) => update("vendor", e.target.value)} maxLength={200} className={fieldClass} />
                  </label>
                  <label className="text-sm font-medium">{t("expenses.notes")}
                    <input value={form.notes} onChange={(e) => update("notes", e.target.value)} maxLength={2000} className={fieldClass} />
                  </label>
                </div>
              </div>
              <footer className="flex justify-end gap-3 border-t border-fb-border bg-fb-surface px-5 py-4 sm:px-6">
                <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold">{t("common.cancel")}</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-60">{saving ? t("common.saving") : t("common.save")}</button>
              </footer>
            </form>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
