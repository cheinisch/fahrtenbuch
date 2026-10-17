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
import { useLocation, useNavigate } from "react-router-dom";

import {
  createVehicle,
  deleteVehicle,
  deregisterVehicle,
  registerVehicle,
  transferVehicle,
  getVehicles,
  getArchivedVehicles,
  restoreVehicle,
  getVehicleShares,
  getSharedVehicleActivity,
  revokeVehicleShare,
  setDefaultVehicle,
  shareVehicle,
  createVehicleShareLink,
  updateVehicle,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import VehicleEditorModal from "../components/vehicles/VehicleEditorModal.jsx";
import VehicleLifecycleModal from "../components/vehicles/VehicleLifecycleModal.jsx";
import PageHeader from "../components/PageHeader.jsx";

function label(vehicle, t) {
  return [vehicle.manufacturer, vehicle.model].filter(Boolean).join(" ") || t("vehicles.noModel");
}

export default function Vehicles() {
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("active");
  const [archivedVehicles, setArchivedVehicles] = useState([]);
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
  const [shareLink, setShareLink] = useState(null);
  const [shareMode, setShareMode] = useState("email");
  const [lifecycleVehicle, setLifecycleVehicle] = useState(null);
  const [lifecycleMode, setLifecycleMode] = useState(null);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [activeRows, archiveRows] = await Promise.all([
        getVehicles(accessToken),
        getArchivedVehicles(accessToken),
      ]);
      setVehicles(activeRows);
      setArchivedVehicles(archiveRows);
    } catch (loadError) {
      setError(loadError.message || t("vehicles.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [accessToken]);

  // Rückmeldung z. B. nach angenommenem Freigabelink anzeigen und aus dem Verlauf entfernen
  useEffect(() => {
    if (typeof location.state?.message === "string") {
      setMessage(location.state.message);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state]);

  async function save(payload) {
    setSaving(true);
    try {
      const result = editing
        ? await updateVehicle(accessToken, editing.id, payload)
        : await createVehicle(accessToken, payload);
      await load();
      setModalOpen(false);
      setEditing(null);
      setMessage(t("vehicles.saved", { vehicle: result.name }));
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(vehicle) {
    setError("");
    try {
      await setDefaultVehicle(accessToken, vehicle.id);
      await load();
      setMessage(t("vehicles.defaultChanged", { vehicle: vehicle.name }));
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function openSharing(vehicle) {
    setError("");
    setSharingVehicle(vehicle);
    setShareAccount("");
    setShareLink(null);
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
      setMessage(t("vehicles.invitationSent", { vehicle: sharingVehicle.name }));
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setShareSaving(false);
    }
  }

  async function generateShareLink() {
    if (!sharingVehicle) return;
    setShareSaving(true); setError("");
    try {
      const result=await createVehicleShareLink(accessToken,sharingVehicle.id);
      setShareLink(result);
      setMessage(t("vehicles.linkCreated"));
    } catch(actionError){ setError(actionError.message); }
    finally { setShareSaving(false); }
  }

  async function copyShareLink() {
    if (!shareLink?.url) return;
    try { await navigator.clipboard.writeText(shareLink.url); setMessage(t("vehicles.linkCopied")); }
    catch { setError(t("vehicles.linkCopyFailed")); }
  }

  async function removeShare(entry) {
    if (!sharingVehicle) return;
    setShareSaving(true);
    setError("");
    try {
      await revokeVehicleShare(accessToken, sharingVehicle.id, entry.userId);
      setShares((current) => current.filter((item) => item.userId !== entry.userId));
      setMessage(t("vehicles.shareRevoked"));
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setShareSaving(false);
    }
  }

  async function remove(vehicle) {
    if (!window.confirm(t("vehicles.archiveConfirm", { vehicle: vehicle.name }))) return;
    setError("");
    try {
      await deleteVehicle(accessToken, vehicle.id);
      setVehicles((current) => current.filter((entry) => entry.id !== vehicle.id));
      setMessage(t("vehicles.archivedMessage", { vehicle: vehicle.name }));
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function restoreArchived(vehicle) {
    setError("");
    try {
      await restoreVehicle(accessToken, vehicle.id);
      setMessage(t("vehicles.restoredMessage", { vehicle: vehicle.name }));
      setView("active");
      await load();
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
        setMessage(t("vehicles.deregisteredMessage", { vehicle: lifecycleVehicle.name }));
      } else if (lifecycleMode === "register") {
        await registerVehicle(accessToken, lifecycleVehicle.id, payload.effectiveAt);
        setMessage(t("vehicles.registeredMessage", { vehicle: lifecycleVehicle.name }));
      } else {
        await transferVehicle(accessToken, lifecycleVehicle.id, payload.account, payload.effectiveAt);
        setMessage(t("vehicles.transferredMessage", { vehicle: lifecycleVehicle.name }));
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

  const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-lg border border-fb-border bg-fb-main px-3 text-[13px] font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent-strong disabled:opacity-50";
  const tabClass = (active) => `h-11 border-b-2 text-sm transition ${active ? "border-fb-accent font-semibold text-fb-accent-strong" : "border-transparent font-medium text-fb-muted hover:text-fb-text"}`;
  const fieldLabel = "text-[11px] uppercase tracking-[0.06em] text-fb-muted";
  const acquisitionLabel = (vehicle) => t(`vehicles.acquisition.${vehicle.acquisitionType || "owned"}`);
  const initials = (name) => String(name || "?").trim().split(/[\s._@-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={t("vehicles.section")} title={t("vehicles.title")} subtitle={t("vehicles.subtitle")}>
        <button type="button" onClick={() => { setEditing(null); setModalOpen(true); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-fb-accent px-[18px] text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary"><PlusIcon className="size-[18px]" />{t("vehicles.add")}</button>
      </PageHeader>

      <div role="tablist" className="flex gap-7 border-b border-fb-border">
        <button type="button" role="tab" aria-selected={view === "active"} onClick={() => setView("active")} className={tabClass(view === "active")}>{t("vehicles.activeTab")} ({vehicles.length})</button>
        <button type="button" role="tab" aria-selected={view === "archive"} onClick={() => setView("archive")} className={tabClass(view === "archive")}>{t("vehicles.archiveTab")} ({archivedVehicles.length})</button>
      </div>

      {message && <div role="status" className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent-strong">{message}</div>}
      {error && <div role="alert" className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}

      {view === "archive" ? (
        archivedVehicles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-fb-border bg-fb-main p-10 text-center"><TrashIcon className="mx-auto size-12 text-fb-muted" /><h2 className="mt-4 text-lg font-bold">{t("vehicles.archiveEmpty")}</h2><p className="mt-2 text-sm text-fb-muted">{t("vehicles.archiveEmptyHint")}</p></div>
        ) : (
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {archivedVehicles.map((vehicle) => (
              <article key={vehicle.id} className="flex flex-col gap-[18px] rounded-xl border border-fb-border bg-fb-main p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fb-surface text-fb-muted"><TruckIcon className="size-6" /></span>
                  <div className="min-w-0"><h2 className="truncate text-lg font-bold">{vehicle.name}</h2><p className="mt-0.5 truncate text-[13px] text-fb-muted">{label(vehicle, t)}</p></div>
                </div>
                <dl className="grid grid-cols-2 gap-3.5 text-sm">
                  <div><dt className={fieldLabel}>{t("vehicles.plate")}</dt><dd className="mt-1 font-semibold">{vehicle.licensePlate || "–"}</dd></div>
                  <div><dt className={fieldLabel}>{t("vehicles.archivedAt")}</dt><dd className="mt-1 font-semibold">{vehicle.archivedAt ? new Date(vehicle.archivedAt).toLocaleDateString(locale) : "–"}</dd></div>
                </dl>
                <div className="mt-auto border-t border-fb-border pt-4"><button type="button" onClick={() => restoreArchived(vehicle)} className={secondaryButton}>{t("vehicles.restore")}</button></div>
              </article>
            ))}
          </div>
        )
      ) : loading ? <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">{t("vehicles.loading")}</div> : vehicles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-fb-border bg-fb-main p-10 text-center"><TruckIcon className="mx-auto size-12 text-fb-muted" /><h2 className="mt-4 text-lg font-bold">{t("vehicles.emptyTitle")}</h2><p className="mt-2 text-sm text-fb-muted">{t("vehicles.emptyHint")}</p></div>
      ) : (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {vehicles.map((vehicle) => {
            const badge = vehicle.isDeregistered
              ? { text: t("vehicles.deregistered"), className: "bg-fb-danger/10 text-fb-danger" }
              : !vehicle.isOwner
                ? { text: t("vehicles.sharedBadge"), className: "bg-fb-surface text-fb-muted" }
                : vehicle.isDefault
                  ? { text: t("vehicles.defaultBadge"), className: "bg-fb-accent-soft text-fb-accent-strong" }
                  : null;
            return (
              <article key={vehicle.id} className="flex flex-col gap-[18px] rounded-xl border border-fb-border bg-fb-main p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${vehicle.isOwner ? "bg-fb-accent-soft text-fb-accent-strong" : "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300"}`}><TruckIcon className="size-6" /></span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-bold">{vehicle.name}</h2>
                      <p className="mt-0.5 truncate text-[13px] text-fb-muted">{label(vehicle, t)}</p>
                    </div>
                  </div>
                  {badge && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>{badge.text}</span>}
                </div>
                {vehicle.isOwner ? (
                <dl className="grid grid-cols-2 gap-3.5 text-sm">
                  <div><dt className={fieldLabel}>{t("vehicles.plate")}</dt><dd className="mt-1 font-semibold">{vehicle.licensePlate || "–"}</dd></div>
                  <div><dt className={fieldLabel}>{t("vehicles.odometer")}</dt><dd className="mt-1 font-semibold">{vehicle.odometerKm == null ? "–" : `${Number(vehicle.odometerKm).toLocaleString(locale, { maximumFractionDigits: 1 })} km`}</dd></div>
                  <div className="min-w-0"><dt className={fieldLabel}>{t("vehicles.bluetooth")}</dt><dd className={`mt-1 truncate ${vehicle.bluetoothMac ? "font-mono text-xs font-medium" : "font-medium"}`}>{vehicle.bluetoothMac || t("vehicles.notAssigned")}</dd></div>
                  <div><dt className={fieldLabel}>{t("vehicles.financing")}</dt><dd className="mt-1 font-medium">{acquisitionLabel(vehicle)}</dd></div>
                </dl>
                ) : (
                  // Mitbenutzer: keine Finanzierungs-/Leasing- oder Bluetooth-Angaben
                  <dl className="grid grid-cols-2 gap-3.5 text-sm">
                    <div><dt className={fieldLabel}>{t("vehicles.plate")}</dt><dd className="mt-1 font-semibold">{vehicle.licensePlate || "–"}</dd></div>
                    <div className="min-w-0"><dt className={fieldLabel}>{t("vehicles.owner")}</dt><dd className="mt-1 truncate font-semibold">{vehicle.ownerDisplayName || vehicle.ownerUsername || t("vehicles.otherUser")}</dd></div>
                  </dl>
                )}
                {vehicle.isOwner && vehicle.sharedWith?.length > 0 && (
                  <button type="button" onClick={() => openSharing(vehicle)} className="flex min-w-0 items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-left text-xs text-orange-900 hover:bg-orange-100 dark:bg-orange-950/60 dark:text-orange-200 dark:hover:bg-orange-950">
                    <span className="flex shrink-0 -space-x-1.5">
                      {vehicle.sharedWith.slice(0, 3).map((entry) => <span key={entry.userId} aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-orange-200 text-[10px] font-bold ring-2 ring-orange-50 dark:bg-orange-900 dark:ring-orange-950">{initials(entry.displayName || entry.username)}</span>)}
                    </span>
                    <span className="min-w-0 truncate"><span className="font-semibold">{t("vehicles.sharedWith")}</span> {vehicle.sharedWith.map((entry) => entry.displayName || entry.username).join(", ")}</span>
                  </button>
                )}
                {vehicle.isOwner && (
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-fb-border pt-4">
                    <button type="button" onClick={() => { setEditing(vehicle); setModalOpen(true); }} className={secondaryButton}>{t("vehicles.edit")}</button>
                    <button type="button" onClick={() => openSharing(vehicle)} className={secondaryButton}>{t("vehicles.share")}</button>
                    {!vehicle.isDeregistered && <button type="button" onClick={() => { setLifecycleVehicle(vehicle); setLifecycleMode("transfer"); }} className={secondaryButton}>{t("vehicleLifecycle.transfer")}</button>}
                    {!vehicle.isDeregistered && <button type="button" onClick={() => { setLifecycleVehicle(vehicle); setLifecycleMode("deregister"); }} className={secondaryButton}>{t("vehicles.deregister")}</button>}
                    {vehicle.isDeregistered && <button type="button" onClick={() => { setLifecycleVehicle(vehicle); setLifecycleMode("register"); }} className={secondaryButton}>{t("vehicles.registerAgain")}</button>}
                    {!vehicle.isDefault && <button type="button" onClick={() => makeDefault(vehicle)} className={secondaryButton}>{t("vehicles.setDefault")}</button>}
                    <button type="button" onClick={() => remove(vehicle)} aria-label={t("vehicles.delete")} className="ml-auto inline-flex size-10 items-center justify-center rounded-lg border border-fb-border text-fb-muted transition hover:border-fb-danger hover:text-fb-danger"><TrashIcon className="size-[17px]" /></button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {sharingVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSharingVehicle(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="share-title" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-fb-border bg-fb-main p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold text-fb-accent-strong">{sharingVehicle.name}</p>
                <h2 id="share-title" className="mt-1 text-xl font-bold">{t("vehicles.shareTitle")}</h2>
                <p className="mt-1.5 text-sm text-fb-muted">{t("vehicles.privacyHint")}</p>
              </div>
              <button type="button" onClick={() => setSharingVehicle(null)} aria-label={t("common.close")} className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-fb-border text-fb-muted hover:text-fb-text"><XMarkIcon className="size-5" /></button>
            </div>

            <div className="mt-6 flex flex-wrap gap-7">
              <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
                <div role="radiogroup" aria-label={t("vehicles.shareTitle")} className="grid grid-cols-2 gap-2.5">
                  {[["email", t("vehicles.emailMode"), t("vehicles.emailHint")], ["link", t("vehicles.linkMode"), t("vehicles.linkHint")]].map(([mode, title, hint]) => (
                    <label key={mode} className={`flex cursor-pointer items-start gap-2.5 rounded-lg p-3 text-sm ${shareMode === mode ? "border-2 border-fb-accent bg-fb-accent-soft/50" : "border border-fb-border"}`}>
                      <input type="radio" name="share-mode" checked={shareMode === mode} onChange={() => setShareMode(mode)} className="mt-0.5 accent-[var(--color-accent)]" />
                      <span><span className="block font-semibold">{title}</span><span className="mt-0.5 block text-xs text-fb-muted">{hint}</span></span>
                    </label>
                  ))}
                </div>

                {shareMode === "email" ? (
                  <form onSubmit={addShare} className="flex flex-col gap-1.5 text-sm font-medium">
                    <label htmlFor="share-email">{t("vehicles.email")}</label>
                    <div className="flex gap-2">
                      <input id="share-email" type="email" value={shareEmail} onChange={(event) => setShareAccount(event.target.value)} placeholder="name@example.org" className="h-11 min-w-0 flex-1 rounded-lg border border-fb-border bg-fb-surface px-3 font-normal" />
                      <button disabled={shareSaving || !shareEmail.trim()} className="h-11 rounded-lg bg-fb-accent px-4 font-semibold text-fb-accent-text disabled:opacity-50">{t("vehicles.share")}</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button type="button" disabled={shareSaving} onClick={generateShareLink} className={`${secondaryButton} self-start`}>{shareLink ? t("vehicles.newLink") : t("vehicles.createLink")}</button>
                    {shareLink && (
                      <div className="rounded-lg bg-fb-surface p-3">
                        <div className="break-all font-mono text-xs">{shareLink.url}</div>
                        <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-fb-muted">{t("vehicles.validUntil", { date: new Date(shareLink.expiresAt).toLocaleString(locale) })}</span><button type="button" onClick={copyShareLink} className="min-h-9 text-sm font-semibold text-fb-accent-strong">{t("vehicles.copy")}</button></div>
                      </div>
                    )}
                  </div>
                )}

                {sharedActivity.length > 0 && (
                  <div className="rounded-lg border border-fb-border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-fb-muted">{t("vehicles.otherUsage")}</p>
                    <div className="mt-2 space-y-1">{sharedActivity.map((entry) => <div key={entry.userId} className="flex justify-between gap-3 text-sm"><span>{entry.label}</span><span className="font-semibold">{entry.tripCount}</span></div>)}</div>
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5">
                <h3 className="text-[15px] font-bold">{t("vehicles.activeShares")}</h3>
                {shares.length === 0 ? <p className="text-sm text-fb-muted">{t("vehicles.noShares")}</p> : shares.map((entry) => (
                  <div key={entry.userId} className="flex items-center justify-between gap-2.5 rounded-lg border border-fb-border p-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-800 dark:bg-orange-950 dark:text-orange-300">{initials(entry.displayName || entry.username)}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{entry.displayName || entry.username}</span><span className="block truncate text-xs text-fb-muted">{entry.email}</span></span>
                    </span>
                    <button type="button" disabled={shareSaving} onClick={() => removeShare(entry)} className="h-9 shrink-0 rounded-lg border border-fb-border px-3 text-[13px] font-semibold text-fb-danger disabled:opacity-50">{t("vehicles.revoke")}</button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      <VehicleLifecycleModal vehicle={lifecycleVehicle} mode={lifecycleMode} saving={lifecycleSaving} onClose={() => { if (!lifecycleSaving) { setLifecycleVehicle(null); setLifecycleMode(null); } }} onConfirm={confirmLifecycle} />

      <VehicleEditorModal open={modalOpen} vehicle={editing} saving={saving} onClose={() => { if (!saving) { setModalOpen(false); setEditing(null); } }} onSubmit={save} />
    </div>
  );
}
