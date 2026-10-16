import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { ArrowUpTrayIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

import { importExpenses, previewExpenseImport } from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";

const FUEL_FIELDS = ["date", "amount", "odometer", "quantity", "tankType", "currency", "vendor", "note"];
const COST_FIELDS = ["date", "amount", "costType", "title", "odometer", "currency", "vendor", "note"];
const REQUIRED = new Set(["date", "amount"]);
const selectClass = "block w-full rounded-lg border border-fb-border bg-fb-surface px-2.5 py-2 text-sm text-fb-text";

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // In Blöcken, sonst sprengt String.fromCharCode bei großen Dateien den Stack
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export default function ExpenseImportModal({ open, vehicles, defaultVehicleId, onClose, onImported }) {
  const { accessToken } = useAuth();
  const { t, number, locale } = useI18n();
  const fileInput = useRef(null);
  const [vehicleId, setVehicleId] = useState(defaultVehicleId || "");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [settings, setSettings] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setVehicleId(defaultVehicleId || vehicles[0]?.id || "");
      setFileName("");
      setContent("");
      setSettings({});
      setPreview(null);
      setError("");
    }
  }, [open, defaultVehicleId, vehicles]);

  async function runPreview(nextContent, nextSettings, nextVehicleId = vehicleId) {
    if (!nextContent || !nextVehicleId) return;
    setBusy(true);
    setError("");
    try {
      const result = await previewExpenseImport(accessToken, { vehicleId: nextVehicleId, content: nextContent, ...nextSettings });
      setPreview(result);
    } catch (previewError) {
      setPreview(null);
      setError(previewError.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError(t("expenses.import.tooLarge"));
      return;
    }
    const encoded = await fileToBase64(file);
    setFileName(file.name);
    setContent(encoded);
    setSettings({});
    await runPreview(encoded, {});
  }

  // Jede Änderung an Optionen/Zuordnung erzeugt eine neue Vorschau vom Server
  function change(patch) {
    const base = preview ? { mapping: preview.mapping, ...preview.options } : {};
    const next = { ...base, ...settings, ...patch };
    // Beim Wechsel Tankungen ↔ Kosten die Zuordnung neu erkennen lassen
    if (patch.kind && patch.kind !== preview?.options?.kind) delete next.mapping;
    setSettings(next);
    runPreview(content, next);
  }

  function changeMapping(field, value) {
    const mapping = { ...(preview?.mapping || {}) };
    if (value === "") delete mapping[field];
    else mapping[field] = Number(value);
    change({ mapping });
  }

  async function runImport() {
    setBusy(true);
    setError("");
    try {
      const result = await importExpenses(accessToken, { vehicleId, content, ...(preview ? { mapping: preview.mapping, ...preview.options } : {}), ...settings });
      onImported(result);
    } catch (importError) {
      setError(importError.message);
    } finally {
      setBusy(false);
    }
  }

  const options = preview?.options || {};
  const fields = options.kind === "costs" ? COST_FIELDS : FUEL_FIELDS;
  const sample = (index) => preview?.sampleRows?.find((row) => String(row[index] ?? "").trim())?.[index] ?? "";
  const formatDate = (value) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
  const money = (value, currency) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  const canImport = preview && !busy && preview.counts.new > 0 && preview.missingRequired.length === 0;

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="w-full max-w-4xl overflow-hidden rounded-2xl border border-fb-border bg-fb-main shadow-2xl">
            <header className="flex items-start justify-between border-b border-fb-border px-5 py-4 sm:px-6">
              <div>
                <DialogTitle className="text-xl font-bold">{t("expenses.import.title")}</DialogTitle>
                <p className="mt-1 text-sm text-fb-muted">{t("expenses.import.subtitle")}</p>
              </div>
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-text disabled:opacity-50">
                <span className="sr-only">{t("common.close")}</span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <div className="space-y-5 p-5 sm:p-6">
              {error && <div role="alert" className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{error}</div>}

              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="text-sm font-medium">{t("expenses.vehicle")}
                  <select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); runPreview(content, settings, e.target.value); }} className={`mt-2 ${selectClass}`}>
                    {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
                  </select>
                </label>
                <div>
                  <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" onChange={chooseFile} className="sr-only" />
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-fb-border bg-fb-main px-4 text-sm font-semibold hover:bg-fb-surface disabled:opacity-50">
                    <ArrowUpTrayIcon className="size-[18px]" />{fileName ? t("expenses.import.otherFile") : t("expenses.import.chooseFile")}
                  </button>
                </div>
              </div>

              {!preview && !busy && (
                <div className="rounded-xl border border-dashed border-fb-border bg-fb-surface p-5 text-sm text-fb-muted">
                  <p className="font-semibold text-fb-text">{t("expenses.import.howToTitle")}</p>
                  <p className="mt-1">{t("expenses.import.howTo")}</p>
                </div>
              )}

              {busy && !preview && <p className="text-sm text-fb-muted">{t("expenses.import.reading")}</p>}

              {preview && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{fileName}</span>
                    {preview.source === "spritmonitor" && <span className="rounded-full bg-fb-accent-soft px-2.5 py-0.5 text-xs font-semibold text-fb-accent-strong">{t("expenses.import.spritmonitorDetected")}</span>}
                    <span className="text-fb-muted">{preview.encoding.toUpperCase()} · „{preview.delimiter === "\t" ? "Tab" : preview.delimiter}“</span>
                  </div>

                  <div className="grid gap-4 rounded-xl border border-fb-border bg-fb-surface p-4 sm:grid-cols-4">
                    <label className="text-xs font-medium text-fb-muted">{t("expenses.import.kind")}
                      <select value={options.kind} onChange={(e) => change({ kind: e.target.value })} className={`mt-1 ${selectClass}`}>
                        <option value="fuel">{t("expenses.import.kindFuel")}</option>
                        <option value="costs">{t("expenses.import.kindCosts")}</option>
                      </select>
                    </label>
                    {options.kind !== "costs" && (
                      <label className="text-xs font-medium text-fb-muted">{t("expenses.import.energy")}
                        <select value={options.energy} onChange={(e) => change({ energy: e.target.value })} className={`mt-1 ${selectClass}`}>
                          <option value="fuel_l">{t("expenses.import.energyLiter")}</option>
                          <option value="charging_kwh">{t("expenses.import.energyKwh")}</option>
                          <option value="fuel_kg">{t("expenses.import.energyKg")}</option>
                        </select>
                      </label>
                    )}
                    <label className="text-xs font-medium text-fb-muted">{t("expenses.import.dateFormat")}
                      <select value={options.dateFormat} onChange={(e) => change({ dateFormat: e.target.value })} className={`mt-1 ${selectClass}`}>
                        {["DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"].map((format) => <option key={format} value={format}>{format}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-fb-muted">{t("expenses.import.decimal")}
                      <select value={options.decimalSeparator} onChange={(e) => change({ decimalSeparator: e.target.value })} className={`mt-1 ${selectClass}`}>
                        <option value=",">{t("expenses.import.decimalComma")}</option>
                        <option value=".">{t("expenses.import.decimalDot")}</option>
                      </select>
                    </label>
                  </div>

                  <details className="rounded-xl border border-fb-border" open={preview.missingRequired.length > 0 || preview.source !== "spritmonitor"}>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{t("expenses.import.mapping")}</summary>
                    <div className="grid gap-3 border-t border-fb-border p-4 sm:grid-cols-2">
                      {fields.map((field) => (
                        <label key={field} className="grid grid-cols-[130px_1fr] items-center gap-3 text-sm">
                          <span>{t(`expenses.import.fields.${field}`)}{REQUIRED.has(field) && <span className="text-fb-danger"> *</span>}</span>
                          <select value={preview.mapping[field] ?? ""} onChange={(e) => changeMapping(field, e.target.value)} className={selectClass}>
                            <option value="">{t("expenses.import.notMapped")}</option>
                            {preview.headers.map((header, index) => (
                              <option key={index} value={index}>{header || `#${index + 1}`}{sample(index) ? ` – ${String(sample(index)).slice(0, 24)}` : ""}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </details>

                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["new", preview.counts.new, "text-fb-accent-strong"],
                      ["duplicates", preview.counts.duplicates, ""],
                      ["errors", preview.counts.errors, preview.counts.errors ? "text-fb-danger" : ""],
                      ["warnings", preview.counts.warnings, ""],
                    ].map(([key, value, className]) => (
                      <div key={key} className="rounded-xl border border-fb-border p-3">
                        <dt className="text-[11px] uppercase tracking-[0.06em] text-fb-muted">{t(`expenses.import.counts.${key}`)}</dt>
                        <dd className={`mt-1 text-xl font-bold ${className}`}>{number(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  {preview.dateRange && (
                    <p className="text-sm text-fb-muted">
                      {t("expenses.import.range", { from: formatDate(preview.dateRange.from), to: formatDate(preview.dateRange.to) })}
                      {options.kind !== "costs" && ` · ${t("expenses.import.fullTanks", { count: preview.counts.fullTanks })}`}
                    </p>
                  )}

                  {preview.preview.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-fb-border">
                      <table className="w-full text-sm">
                        <thead className="bg-fb-surface text-left text-fb-muted">
                          <tr>
                            <th className="px-3 py-2 font-medium">{t("expenses.date")}</th>
                            <th className="px-3 py-2 font-medium">{t("expenses.category")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("expenses.quantity")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("expenses.odometer")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("expenses.amount")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.preview.map((entry) => (
                            <tr key={entry.line} className="border-t border-fb-border">
                              <td className="px-3 py-2 whitespace-nowrap">{formatDate(entry.date)}</td>
                              <td className="px-3 py-2">{t(`expenses.categories.${entry.category}`)}{entry.fullTank ? ` · ${entry.category === "charging" ? t("expenses.fullCharge") : t("expenses.fullTank")}` : ""}{entry.notes ? <span className="block max-w-[260px] truncate text-xs text-fb-muted">{entry.notes}</span> : null}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">{entry.quantity == null ? "–" : `${number(entry.quantity, { maximumFractionDigits: 2 })} ${t(`expenses.units.${entry.quantityUnit}`)}`}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">{entry.odometerKm == null ? "–" : `${number(entry.odometerKm, { maximumFractionDigits: 1 })} km`}</td>
                              <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{money(entry.amount, entry.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {[...preview.errors.map((item) => ({ ...item, kind: "error" })), ...preview.warnings.map((item) => ({ ...item, kind: "warning" }))].length > 0 && (
                    <details className="rounded-xl border border-fb-border">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{t("expenses.import.messages")}</summary>
                      <ul className="max-h-48 space-y-1 overflow-y-auto border-t border-fb-border px-4 py-3 text-xs">
                        {preview.errors.map((item, index) => <li key={`e${index}`} className="text-fb-danger">{item.line ? `${t("expenses.import.line", { line: item.line })}: ` : ""}{item.message}</li>)}
                        {preview.warnings.map((item, index) => <li key={`w${index}`} className="text-fb-muted">{item.line ? `${t("expenses.import.line", { line: item.line })}: ` : ""}{item.message}</li>)}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-fb-border bg-fb-surface px-5 py-4 sm:px-6">
              {busy && preview && <span className="mr-auto text-sm text-fb-muted">{t("expenses.import.updating")}</span>}
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold">{t("common.cancel")}</button>
              <button type="button" onClick={runImport} disabled={!canImport} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-60">
                {preview ? t("expenses.import.submit", { count: preview.counts.new }) : t("expenses.import.submitEmpty")}
              </button>
            </footer>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
