import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";

export default function VehicleLifecycleModal({ vehicle, mode, saving, onClose, onConfirm }) {
  const { t }=useI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [account, setAccount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    setConfirmed(false);
    setAccount("");
    setEffectiveDate(new Date().toISOString().slice(0, 10));
  }, [vehicle, mode]);

  if (!vehicle || !mode) return null;
  const deregister = mode === "deregister";

  function submit(event) {
    event.preventDefault();
    if (deregister) onConfirm();
    else onConfirm({ account: account.trim(), effectiveAt: `${effectiveDate}T00:00:00` });
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <form onSubmit={submit} className="w-full max-w-lg rounded-xl border border-fb-border bg-fb-main p-5 shadow-xl">
      <h2 className="text-xl font-bold">{deregister ? t("vehicleLifecycle.deregister") : t("vehicleLifecycle.transfer")}</h2>
      <p className="mt-1 text-sm text-fb-muted">{vehicle.name}</p>
      {deregister ? <>
        <div className="mt-5 rounded-lg border border-fb-danger p-4 text-sm">
          {t("vehicleLifecycle.deregisterHint")}
        </div>
        <label className="mt-5 flex gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4" /><span>{t("vehicleLifecycle.confirm")}</span></label>
      </> : <>
        <p className="mt-5 text-sm text-fb-muted">{t("vehicleLifecycle.transferHint")}</p>
        <label className="mt-4 block text-sm">{t("vehicleLifecycle.newOwner")}<input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="{t("vehicleLifecycle.accountPlaceholder")}" className="mt-1 w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2" /></label>
        <label className="mt-4 block text-sm">{t("vehicleLifecycle.date")}<input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1 w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2" /></label>
      </>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-fb-border px-4 py-2 text-sm font-semibold">{t("common.cancel")}</button><button disabled={saving || (deregister ? !confirmed : (!account.trim() || !effectiveDate))} className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${deregister ? "bg-fb-danger text-white" : "bg-fb-accent text-fb-accent-text"}`}>{saving ? t("common.saving") : deregister ? t("vehicleLifecycle.confirmDeregister") : t("vehicleLifecycle.transfer")}</button></div>
    </form>
  </div>;
}
