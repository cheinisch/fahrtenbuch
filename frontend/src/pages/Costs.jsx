import {
  BanknotesIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";

import {
  createExpense,
  deleteExpense,
  getExpenseSummary,
  getExpenses,
  getVehicles,
  updateExpense,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import PageHeader from "../components/PageHeader.jsx";
import ExpenseEditorModal, { ENERGY_CATEGORIES } from "../components/expenses/ExpenseEditorModal.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

const TRIP_TYPES = ["business", "commute", "private", "unclassified"];
const selectClass = "mt-1 block h-11 rounded-lg border border-fb-border bg-fb-main px-3 text-sm text-fb-text";
const fieldLabel = "text-[11px] uppercase tracking-[0.06em] text-fb-muted";

export default function Costs() {
  const { accessToken } = useAuth();
  const { t, locale, number } = useI18n();
  const currentYear = String(new Date().getFullYear());

  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState({ open: false, expense: null, mode: "energy" });
  const [saving, setSaving] = useState(false);

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const years = useMemo(() => Array.from({ length: 6 }, (_, index) => String(Number(currentYear) - index)), [currentYear]);

  const money = (value, currency = "EUR") =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  const formatDate = (value) =>
    value ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`)) : "–";
  const percent = (value) => (value == null ? "–" : number(value, { style: "percent", maximumFractionDigits: 1 }));

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Kosten erfasst zunächst nur der Fahrzeughalter
        const rows = (await getVehicles(accessToken)).filter((vehicle) => vehicle.isOwner !== false);
        if (!active) return;
        setVehicles(rows);
        setVehicleId((current) => current || rows.find((vehicle) => vehicle.isDefault)?.id || rows[0]?.id || "");
        if (rows.length === 0) setLoading(false);
      } catch (loadError) {
        if (active) { setError(loadError.message); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [accessToken]);

  async function load() {
    if (!vehicleId) return;
    setLoading(true);
    setError("");
    try {
      const [rows, totals] = await Promise.all([
        getExpenses(accessToken, { vehicleId, from, to }),
        getExpenseSummary(accessToken, { vehicleId, from, to }),
      ]);
      setExpenses(rows);
      setSummary(totals);
    } catch (loadError) {
      setError(loadError.message || t("expenses.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [accessToken, vehicleId, year]);

  async function save(payload) {
    setSaving(true);
    try {
      if (editor.expense) await updateExpense(accessToken, editor.expense.id, payload);
      else await createExpense(accessToken, payload);
      setEditor((current) => ({ ...current, open: false }));
      setMessage(t("expenses.saved"));
      if (payload.vehicleId !== vehicleId) setVehicleId(payload.vehicleId);
      else await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(expense) {
    if (!window.confirm(t("expenses.deleteConfirm"))) return;
    setError("");
    try {
      await deleteExpense(accessToken, expense.id);
      setMessage(t("expenses.deleted"));
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  const primaryCost = summary?.costs?.[0] || null;
  const otherCurrencies = summary?.costs?.slice(1) || [];
  const consumption = summary?.consumption || [];
  const maxCategory = Math.max(1, ...(primaryCost?.byCategory || []).map((entry) => entry.amount));

  function details(expense) {
    const parts = [];
    if (expense.quantity != null) {
      parts.push(`${number(expense.quantity, { maximumFractionDigits: 2 })} ${t(`expenses.units.${expense.quantityUnit}`)}`);
      if (expense.pricePerUnit != null) {
        parts.push(`${number(expense.pricePerUnit, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${expense.currency}/${t(`expenses.units.${expense.quantityUnit}`)}`);
      }
    }
    if (expense.odometerKm != null) parts.push(`${number(expense.odometerKm, { maximumFractionDigits: 1 })} km`);
    if (expense.fullTank) parts.push(expense.category === "charging" ? t("expenses.fullCharge") : t("expenses.fullTank"));
    if (expense.periodStart) parts.push(`${formatDate(expense.periodStart)} – ${formatDate(expense.periodEnd)}`);
    if (expense.vendor) parts.push(expense.vendor);
    return parts.join(" · ");
  }

  const primaryButton = "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-fb-accent px-[18px] text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-50";
  const secondaryButton = "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-fb-border bg-fb-main px-[18px] text-sm font-semibold hover:bg-fb-surface disabled:opacity-50";

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={t("expenses.section")} title={t("expenses.title")} subtitle={t("expenses.subtitle")}>
        <label className="text-xs font-medium text-fb-muted">{t("expenses.vehicle")}
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={`${selectClass} min-w-[200px]`} disabled={vehicles.length === 0}>
            {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-fb-muted">{t("expenses.year")}
          <select value={year} onChange={(e) => setYear(e.target.value)} className={selectClass}>
            {years.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <button type="button" disabled={!vehicleId} onClick={() => setEditor({ open: true, expense: null, mode: "energy" })} className={primaryButton}><PlusIcon className="size-[18px]" />{t("expenses.addEnergy")}</button>
        <button type="button" disabled={!vehicleId} onClick={() => setEditor({ open: true, expense: null, mode: "other" })} className={secondaryButton}><PlusIcon className="size-[18px]" />{t("expenses.addOther")}</button>
      </PageHeader>

      {message && <div role="status" className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent-strong">{message}</div>}
      {error && <div role="alert" className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}

      {vehicles.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-fb-border bg-fb-main p-10 text-center"><BanknotesIcon className="mx-auto size-12 text-fb-muted" /><h2 className="mt-4 text-lg font-bold">{t("expenses.noVehicles")}</h2><p className="mt-2 text-sm text-fb-muted">{t("expenses.noVehiclesHint")}</p></div>
      ) : (
        <>
          <section className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
            <article className="rounded-xl border border-fb-border bg-fb-main p-5">
              <p className={fieldLabel}>{t("expenses.totalCosts")}</p>
              <p className="mt-2 text-2xl font-bold">{primaryCost ? money(primaryCost.total, primaryCost.currency) : money(0)}</p>
              {otherCurrencies.map((entry) => <p key={entry.currency} className="mt-1 text-sm text-fb-muted">+ {money(entry.total, entry.currency)}</p>)}
            </article>
            <article className="rounded-xl border border-fb-border bg-fb-main p-5">
              <p className={fieldLabel}>{t("expenses.costPerKm")}</p>
              <p className="mt-2 text-2xl font-bold">{primaryCost?.costPerKm != null ? `${number(primaryCost.costPerKm, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} ${primaryCost.currency}` : "–"}</p>
              <p className="mt-1 text-xs text-fb-muted">{t("expenses.costPerKmHint")}</p>
            </article>
            <article className="rounded-xl border border-fb-border bg-fb-main p-5">
              <p className={fieldLabel}>{t("expenses.consumption")}</p>
              {consumption.length === 0 ? (
                <><p className="mt-2 text-2xl font-bold">–</p><p className="mt-1 text-xs text-fb-muted">{t("expenses.consumptionHint")}</p></>
              ) : consumption.map((entry) => (
                <p key={entry.unit} className="mt-2 text-2xl font-bold">{number(entry.per100Km, { maximumFractionDigits: 2 })} <span className="text-base font-semibold text-fb-muted">{t(`expenses.units.${entry.unit}`)}/100 km</span></p>
              ))}
            </article>
            <article className="rounded-xl border border-fb-border bg-fb-main p-5">
              <p className={fieldLabel}>{t("expenses.drivenKm")}</p>
              <p className="mt-2 text-2xl font-bold">{summary ? `${number(summary.distance.totalKm, { maximumFractionDigits: 0 })} km` : "–"}</p>
              <p className="mt-1 text-xs text-fb-muted">{t("expenses.tripCount", { count: summary?.distance.tripCount ?? 0 })}</p>
            </article>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-xl border border-fb-border bg-fb-main p-5">
              <h2 className="text-lg font-bold">{t("expenses.byCategory")}</h2>
              {!primaryCost?.byCategory?.length ? (
                <p className="mt-3 text-sm text-fb-muted">{t("expenses.noCosts")}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {primaryCost.byCategory.map((entry) => (
                    <li key={entry.category}>
                      <div className="flex justify-between gap-3 text-sm"><span>{t(`expenses.categories.${entry.category}`)}</span><span className="font-semibold">{money(entry.amount, primaryCost.currency)}</span></div>
                      <div className="mt-1.5 h-2 rounded-full bg-fb-surface"><div className="h-2 rounded-full bg-fb-accent" style={{ width: `${(entry.amount / maxCategory) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs text-fb-muted">{t("expenses.periodAllocationHint")}</p>
            </article>
            <article className="rounded-xl border border-fb-border bg-fb-main p-5">
              <h2 className="text-lg font-bold">{t("expenses.byTripType")}</h2>
              <p className="mt-1 text-sm text-fb-muted">{t("expenses.byTripTypeHint")}</p>
              <table className="mt-4 w-full text-sm">
                <thead><tr className="text-left text-fb-muted"><th className="pb-2 font-medium">{t("expenses.tripType")}</th><th className="pb-2 text-right font-medium">km</th><th className="pb-2 text-right font-medium">{t("expenses.share")}</th><th className="pb-2 text-right font-medium">{t("expenses.costShare")}</th></tr></thead>
                <tbody>
                  {TRIP_TYPES.map((type) => (
                    <tr key={type} className="border-t border-fb-border">
                      <td className="py-2">{t(`expenses.tripTypes.${type}`)}</td>
                      <td className="py-2 text-right">{summary ? number(summary.distance.byTripType[type] || 0, { maximumFractionDigits: 0 }) : "–"}</td>
                      <td className="py-2 text-right">{percent(summary?.distance.shares[type])}</td>
                      <td className="py-2 text-right font-semibold">{primaryCost?.byTripType?.[type] != null ? money(primaryCost.byTripType[type], primaryCost.currency) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-xs text-fb-muted">{t("expenses.taxHint")}</p>
            </article>
          </section>

          <section className="rounded-xl border border-fb-border bg-fb-main">
            <h2 className="border-b border-fb-border px-5 py-4 text-lg font-bold">{t("expenses.entries", { year })}</h2>
            {loading ? (
              <p className="p-5 text-sm text-fb-muted">{t("common.loading")}</p>
            ) : expenses.length === 0 ? (
              <p className="p-5 text-sm text-fb-muted">{t("expenses.empty")}</p>
            ) : (
              <ul className="divide-y divide-fb-border">
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="w-28 shrink-0 text-sm text-fb-muted">{formatDate(expense.date)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t(`expenses.categories.${expense.category}`)}</p>
                      <p className="truncate text-xs text-fb-muted">{details(expense) || expense.notes || "–"}</p>
                    </div>
                    <span className="text-sm font-semibold">{money(expense.amount, expense.currency)}</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditor({ open: true, expense, mode: ENERGY_CATEGORIES.includes(expense.category) ? "energy" : "other" })} className="rounded-lg p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-text"><span className="sr-only">{t("expenses.edit")}</span><PencilSquareIcon className="size-5" /></button>
                      <button type="button" onClick={() => remove(expense)} className="rounded-lg p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-danger"><span className="sr-only">{t("expenses.delete")}</span><TrashIcon className="size-5" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ExpenseEditorModal
        open={editor.open}
        expense={editor.expense}
        mode={editor.mode}
        vehicles={vehicles}
        defaultVehicleId={vehicleId}
        saving={saving}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
        onSubmit={save}
      />
    </div>
  );
}
