import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { inspectVehicleShareInvitation, respondVehicleShareInvitation } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import Vehicles from "./Vehicles.jsx";

const ICONS = {
  vehicle: <><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v2H3z" /><circle cx="7.5" cy="16" r="1.5" /><circle cx="16.5" cy="16" r="1.5" /><path d="M5 11h14" /></>,
  expired: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};

const TONES = {
  accent: "bg-fb-accent-soft text-fb-accent",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  neutral: "bg-fb-surface text-fb-muted",
};

function Icon({ icon, tone }) {
  return (
    <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
    </span>
  );
}

// Freigabelink: wird über der Fahrzeugliste als Modal angezeigt. Nicht angemeldete
// Benutzer landen über ProtectedRoute auf dem Login und kehren danach mit Token hierher zurück.
export default function ShareInvitation() {
  const { accessToken } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState({ loading: true, data: null, error: "", busy: false });
  const primaryRef = useRef(null);

  useEffect(() => {
    if (!token) {
      setState({ loading: false, data: null, error: t("shareInvitation.notFound"), busy: false });
      return;
    }
    inspectVehicleShareInvitation(accessToken, token)
      .then((data) => setState({ loading: false, data, error: "", busy: false }))
      .catch((error) => setState({ loading: false, data: null, error: error.code === "SHARE_INVITATION_NOT_FOUND" ? t("shareInvitation.unknown") : error.message, busy: false }));
  }, [accessToken, token]);

  // Schließen ohne Antwort: Der Link bleibt bis zum Ablauf gültig
  function close(message) {
    navigate("/vehicles", { replace: true, state: message ? { message } : null });
  }

  useEffect(() => {
    if (state.loading) return undefined;
    primaryRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape" && !state.busy) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.loading, state.busy]);

  async function respond(action) {
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      await respondVehicleShareInvitation(accessToken, token, action);
      close(action === "accept"
        ? t("shareInvitation.addedMessage", { vehicle: state.data.vehicleName })
        : t("shareInvitation.declinedMessage"));
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.code === "SHARE_INVITATION_NOT_FOUND" ? t("shareInvitation.unknown") : error.message }));
    }
  }

  const d = state.data;
  const primaryButton = "min-h-11 rounded-lg bg-fb-accent px-5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-50";
  const secondaryButton = "min-h-11 rounded-lg border border-fb-border px-5 text-sm font-semibold hover:border-fb-accent disabled:opacity-50";

  // Zustände ohne Annahme-Möglichkeit: Hinweis plus Schließen
  let notice = null;
  if (!state.loading) {
    if (!d) notice = { icon: "info", tone: "neutral", title: t("shareInvitation.title"), text: state.error, alert: true };
    else if (d.expired || d.status === "expired") notice = { icon: "expired", tone: "warning", title: t("shareInvitation.expired"), text: t("shareInvitation.expiredHint") };
    else if (d.status !== "pending") notice = { icon: "info", tone: "neutral", title: t("shareInvitation.usedTitle"), text: t("shareInvitation.usedHint") };
    else if (d.isOwnVehicle) notice = { icon: "info", tone: "neutral", title: t("shareInvitation.ownVehicle"), text: t("shareInvitation.ownVehicleHint") };
    else if (!d.intendedForCurrentUser) notice = { icon: "info", tone: "warning", title: t("shareInvitation.wrongUser"), text: t("shareInvitation.wrongUserHint") };
  }

  return (
    <>
      <Vehicles />
      {!state.loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !state.busy) close(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="share-invitation-title" className="w-full max-w-md rounded-xl border border-fb-border bg-fb-main p-6 shadow-xl">
            {notice ? (
              <>
                <div className="flex items-start gap-4">
                  <Icon icon={notice.icon} tone={notice.tone} />
                  <div className="min-w-0">
                    <h2 id="share-invitation-title" className="text-lg font-bold">{notice.title}</h2>
                    <p role={notice.alert ? "alert" : undefined} className={`mt-1.5 text-sm ${notice.alert ? "text-fb-danger" : "text-fb-muted"}`}>{notice.text}</p>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button ref={primaryRef} type="button" onClick={() => close()} className={secondaryButton}>{t("common.close")}</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <Icon icon="vehicle" tone="accent" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-fb-accent-strong">{t("shareInvitation.section")}</p>
                      <h2 id="share-invitation-title" className="mt-0.5 text-lg font-bold">{t("shareInvitation.addTitle")}</h2>
                    </div>
                  </div>
                  <button type="button" disabled={state.busy} onClick={() => close()} aria-label={t("common.close")} className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-fb-border text-fb-muted hover:text-fb-text disabled:opacity-50"><XMarkIcon className="size-5" /></button>
                </div>
                <p className="mt-4 text-sm">{t("shareInvitation.addQuestion")}</p>
                <dl className="mt-3 space-y-2.5 rounded-xl bg-fb-surface p-4 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-fb-muted">{t("shareInvitation.name")}</dt><dd className="min-w-0 truncate text-right font-semibold">{d.vehicleName}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-fb-muted">{t("shareInvitation.owner")}</dt><dd className="min-w-0 truncate text-right font-semibold">{d.ownerName}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-fb-muted">{t("shareInvitation.plate")}</dt><dd className="min-w-0 truncate text-right font-semibold">{d.licensePlate || "–"}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-fb-muted">{t("shareInvitation.privacy")}</p>
                {state.error && <p role="alert" className="mt-3 text-sm text-fb-danger">{state.error}</p>}
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <button type="button" disabled={state.busy} onClick={() => respond("decline")} className={secondaryButton}>{t("vehicles.decline")}</button>
                  <button ref={primaryRef} type="button" disabled={state.busy} onClick={() => respond("accept")} className={primaryButton}>{t("shareInvitation.add")}</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
