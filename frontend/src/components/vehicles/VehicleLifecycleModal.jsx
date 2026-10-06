import { useEffect, useState } from "react";

export default function VehicleLifecycleModal({ vehicle, mode, saving, onClose, onConfirm }) {
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
      <h2 className="text-xl font-bold">{deregister ? "Fahrzeug abmelden" : "Besitzer wechseln"}</h2>
      <p className="mt-1 text-sm text-fb-muted">{vehicle.name}</p>
      {deregister ? <>
        <div className="mt-5 rounded-lg border border-fb-danger p-4 text-sm">
          Nach der Abmeldung ist das Fahrzeug für neue Fahrten und Tracking gesperrt. Es können keine weiteren Kilometerstände oder sonstigen neuen Fahrzeugdaten erfasst werden. Vorhandene Daten und Fahrten bleiben erhalten.
        </div>
        <label className="mt-5 flex gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4" /><span>Ich bestätige, dass mit diesem Fahrzeug ab der Abmeldung keine weiteren Kilometer gefahren bzw. im Fahrtenbuch erfasst werden können.</span></label>
      </> : <>
        <p className="mt-5 text-sm text-fb-muted">Bis zum Übergabedatum bleibt die bisherige Besitzperiode erhalten. Ab diesem Datum gehört das Fahrzeug dem neuen Benutzer. Frühere eigene Fahrten des neuen Besitzers bleiben für ihn sichtbar; Fahrten anderer Benutzer werden dadurch nicht freigegeben.</p>
        <label className="mt-4 block text-sm">Neuer Besitzer<input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Benutzername oder E-Mail" className="mt-1 w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2" /></label>
        <label className="mt-4 block text-sm">Übergabedatum<input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1 w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2" /></label>
      </>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-fb-border px-4 py-2 text-sm font-semibold">Abbrechen</button><button disabled={saving || (deregister ? !confirmed : (!account.trim() || !effectiveDate))} className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${deregister ? "bg-fb-danger text-white" : "bg-fb-accent text-fb-accent-text"}`}>{saving ? "Speichert …" : deregister ? "Verbindlich abmelden" : "Besitzer wechseln"}</button></div>
    </form>
  </div>;
}
