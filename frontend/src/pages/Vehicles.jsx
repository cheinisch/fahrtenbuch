import {
  CheckBadgeIcon,
  PencilSquareIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  UserPlusIcon,
  XMarkIcon,
  TruckIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

import {
  createVehicle,
  deleteVehicle,
  deregisterVehicle,
  transferVehicle,
  getVehicles,
  getVehicleShares,
  getSharedVehicleActivity,
  revokeVehicleShare,
  setDefaultVehicle,
  shareVehicle,
  updateVehicle,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import VehicleEditorModal from "../components/vehicles/VehicleEditorModal.jsx";
import VehicleLifecycleModal from "../components/vehicles/VehicleLifecycleModal.jsx";

function label(vehicle) {
  return [vehicle.manufacturer, vehicle.model].filter(Boolean).join(" ") || "Keine Modellangabe";
}

export default function Vehicles() {
  const { accessToken } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharingVehicle, setSharingVehicle] = useState(null);
  const [shares, setShares] = useState([]);
  const [sharedActivity, setSharedActivity] = useState([]);
  const [shareEmail, setShareAccount] = useState("");
  const [shareSaving, setShareSaving] = useState(false);
  const [lifecycleVehicle, setLifecycleVehicle] = useState(null);
  const [lifecycleMode, setLifecycleMode] = useState(null);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setVehicles(await getVehicles(accessToken));
    } catch (loadError) {
      setError(loadError.message || "Die Fahrzeuge konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [accessToken]);

  async function save(payload) {
    setSaving(true);
    try {
      const result = editing
        ? await updateVehicle(accessToken, editing.id, payload)
        : await createVehicle(accessToken, payload);
      await load();
      setModalOpen(false);
      setEditing(null);
      setMessage(`Fahrzeug „${result.name}“ wurde gespeichert.`);
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(vehicle) {
    setError("");
    try {
      await setDefaultVehicle(accessToken, vehicle.id);
      await load();
      setMessage(`„${vehicle.name}“ ist jetzt das Standardfahrzeug.`);
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function openSharing(vehicle) {
    setError("");
    setSharingVehicle(vehicle);
    setShareAccount("");
    try {
      const [shareRows, activityRows] = await Promise.all([
        getVehicleShares(accessToken, vehicle.id),
        getSharedVehicleActivity(accessToken, vehicle.id),
      ]);
      setShares(shareRows);
      setSharedActivity(activityRows);
    } catch (actionError) {
      setError(actionError.message);
      setSharingVehicle(null);
    }
  }

  async function addShare(event) {
    event.preventDefault();
    if (!sharingVehicle || !shareEmail.trim()) return;
    setShareSaving(true);
    setError("");
    try {
      await shareVehicle(accessToken, sharingVehicle.id, shareEmail.trim());
      setShares(await getVehicleShares(accessToken, sharingVehicle.id));
      setShareAccount("");
      setMessage(`Einladung für „${sharingVehicle.name}“ wurde per E-Mail versendet. Die Freigabe erscheint erst nach Bestätigung.`);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setShareSaving(false);
    }
  }

  async function removeShare(entry) {
    if (!sharingVehicle) return;
    setShareSaving(true);
    setError("");
    try {
      await revokeVehicleShare(accessToken, sharingVehicle.id, entry.userId);
      setShares((current) => current.filter((item) => item.userId !== entry.userId));
      setMessage("Fahrzeugfreigabe wurde entfernt.");
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setShareSaving(false);
    }
  }

  async function remove(vehicle) {
    if (!window.confirm(`Fahrzeug „${vehicle.name}“ wirklich löschen? Vorhandene Fahrten bleiben erhalten.`)) return;
    setError("");
    try {
      await deleteVehicle(accessToken, vehicle.id);
      setVehicles((current) => current.filter((entry) => entry.id !== vehicle.id));
      setMessage(`Fahrzeug „${vehicle.name}“ wurde gelöscht.`);
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function confirmLifecycle(payload) {
    if (!lifecycleVehicle) return;
    setLifecycleSaving(true);
    setError("");
    try {
      if (lifecycleMode === "deregister") {
        await deregisterVehicle(accessToken, lifecycleVehicle.id);
        setMessage(`Fahrzeug „${lifecycleVehicle.name}“ wurde abgemeldet und für neue Erfassungen gesperrt.`);
      } else {
        await transferVehicle(accessToken, lifecycleVehicle.id, payload.account, payload.effectiveAt);
        setMessage(`Fahrzeug „${lifecycleVehicle.name}“ wurde zum gewählten Stichtag übertragen.`);
      }
      setLifecycleVehicle(null);
      setLifecycleMode(null);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setLifecycleSaving(false);
    }
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-semibold text-fb-accent">Fahrzeuge</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Meine Fahrzeuge</h1><p className="mt-2 text-fb-muted">Eigene Fahrzeuge verwalten und mit anderen Benutzern gemeinsam nutzen.</p></div>
        <button type="button" onClick={() => { setEditing(null); setModalOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary"><PlusIcon className="size-5" />Fahrzeug anlegen</button>
      </header>

      {message && <div className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent">{message}</div>}
      {error && <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}

      {loading ? <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">Fahrzeuge werden geladen …</div> : vehicles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-fb-border bg-fb-main p-10 text-center"><TruckIcon className="mx-auto size-12 text-fb-muted" /><h2 className="mt-4 text-lg font-bold">Noch kein Fahrzeug</h2><p className="mt-2 text-sm text-fb-muted">Lege dein erstes Fahrzeug an, bevor du Fahrten erfasst.</p></div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((vehicle) => (
            <article key={vehicle.id} className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fb-accent-soft text-fb-accent"><TruckIcon className="size-6" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-bold">{vehicle.name}</h2>{vehicle.isDeregistered && <span className="rounded-full border border-fb-danger px-2 py-0.5 text-xs font-semibold text-fb-danger">Abgemeldet</span>}{vehicle.isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-fb-accent-soft px-2 py-0.5 text-xs font-semibold text-fb-accent"><CheckBadgeIcon className="size-4" />Standard</span>}</div><p className="mt-1 truncate text-sm text-fb-muted">{label(vehicle)}</p></div></div></div>
              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs uppercase tracking-wide text-fb-muted">Kennzeichen</dt><dd className="mt-1 font-semibold">{vehicle.licensePlate || "-"}</dd></div><div><dt className="text-xs uppercase tracking-wide text-fb-muted">Kilometerstand</dt><dd className="mt-1 font-semibold">{vehicle.odometerKm == null ? "-" : `${Number(vehicle.odometerKm).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`}</dd></div><div className="col-span-2"><dt className="text-xs uppercase tracking-wide text-fb-muted">Bluetooth</dt><dd className="mt-1 font-mono text-xs">{vehicle.bluetoothMac || "Nicht zugeordnet"}</dd></div></dl>
              {!vehicle.isOwner && <div className="mt-4 rounded-lg bg-fb-accent-soft px-3 py-2 text-xs font-semibold text-fb-accent">Geteilt von {vehicle.owner?.displayName || vehicle.owner?.username || "einem anderen Benutzer"}</div>}
              <div className="mt-5 flex flex-wrap gap-2 border-t border-fb-border pt-4">
                {vehicle.isOwner && <button type="button" onClick={() => { setEditing(vehicle); setModalOpen(true); }} className="inline-flex items-center gap-2 rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent"><PencilSquareIcon className="size-4" />Bearbeiten</button>}
                {vehicle.isOwner && !vehicle.isDeregistered && <button type="button" onClick={() => { setLifecycleVehicle(vehicle); setLifecycleMode("transfer"); }} className="inline-flex items-center gap-2 rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent">Besitzer wechseln</button>}
                {vehicle.isOwner && !vehicle.isDeregistered && <button type="button" onClick={() => { setLifecycleVehicle(vehicle); setLifecycleMode("deregister"); }} className="inline-flex items-center gap-2 rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-danger hover:text-fb-danger">Abmelden</button>}
                                {vehicle.isOwner && <button type="button" onClick={() => openSharing(vehicle)} className="inline-flex items-center gap-2 rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent"><UserPlusIcon className="size-4" />Teilen</button>}
                {vehicle.isOwner && !vehicle.isDefault && <button type="button" onClick={() => makeDefault(vehicle)} className="inline-flex items-center gap-2 rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent"><StarIcon className="size-4" />Als Standard</button>}
                {vehicle.isOwner && <button type="button" onClick={() => remove(vehicle)} className="ml-auto inline-flex items-center justify-center rounded-lg border border-fb-border p-2 text-fb-muted hover:border-fb-danger hover:text-fb-danger"><TrashIcon className="size-5" /><span className="sr-only">Löschen</span></button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {sharingVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-fb-border bg-fb-main p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="text-xl font-bold">Fahrzeug teilen</h2><p className="mt-1 text-sm text-fb-muted">{sharingVehicle.name}</p></div>
              <button type="button" onClick={() => setSharingVehicle(null)} className="rounded-lg p-2 text-fb-muted hover:text-fb-text"><XMarkIcon className="size-5" /></button>
            </div>
            <form onSubmit={addShare} className="mt-5 flex gap-2">
              <input value={shareEmail} onChange={(event) => setShareAccount(event.target.value)} placeholder="E-Mail-Adresse" className="min-w-0 flex-1 rounded-lg border border-fb-border bg-fb-surface px-3 py-2 text-sm" />
              <button disabled={shareSaving || !shareEmail.trim()} className="rounded-lg bg-fb-accent px-4 py-2 text-sm font-semibold text-fb-accent-text disabled:opacity-50">Teilen</button>
            </form>
            {sharedActivity.length > 0 && <div className="mt-5 rounded-lg border border-fb-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-fb-muted">Nutzung durch andere Benutzer</p><div className="mt-2 space-y-1">{sharedActivity.map((entry) => <div key={entry.userId} className="flex justify-between gap-3 text-sm"><span>{entry.label}</span><span className="font-semibold">{entry.tripCount}</span></div>)}</div><p className="mt-2 text-xs text-fb-muted">Aus Datenschutzgründen werden keine Ziele, Routen oder Fahrtdetails anderer Benutzer angezeigt.</p></div>}
            <div className="mt-5 space-y-2">
              {shares.length === 0 ? <p className="text-sm text-fb-muted">Noch mit niemandem geteilt.</p> : shares.map((entry) => (
                <div key={entry.userId} className="flex items-center justify-between gap-3 rounded-lg border border-fb-border px-3 py-2">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{entry.displayName || entry.username}</p><p className="truncate text-xs text-fb-muted">@{entry.username} · {entry.email}</p></div>
                  <button type="button" disabled={shareSaving} onClick={() => removeShare(entry)} className="text-sm font-semibold text-fb-danger disabled:opacity-50">Entziehen</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <VehicleLifecycleModal vehicle={lifecycleVehicle} mode={lifecycleMode} saving={lifecycleSaving} onClose={() => { if (!lifecycleSaving) { setLifecycleVehicle(null); setLifecycleMode(null); } }} onConfirm={confirmLifecycle} />

            <VehicleEditorModal open={modalOpen} vehicle={editing} saving={saving} onClose={() => { if (!saving) { setModalOpen(false); setEditing(null); } }} onSubmit={save} />
    </div>
  );
}
