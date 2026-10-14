import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { inspectVehicleShareInvitation, respondVehicleShareInvitation } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

const ICONS = {
  vehicle: <><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v2H3z" /><circle cx="7.5" cy="16" r="1.5" /><circle cx="16.5" cy="16" r="1.5" /><path d="M5 11h14" /></>,
  success: <path d="M5 12l5 5 9-10" />,
  expired: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};

const TONES = {
  accent: "bg-fb-accent-soft text-fb-accent",
  success: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  neutral: "bg-fb-surface text-fb-muted",
};

function StateCard({ icon, tone, title, children }) {
  return (
    <section className="flex flex-col items-center gap-4 rounded-2xl border border-fb-border bg-fb-main p-8 text-center shadow-sm">
      <span className={`flex size-16 items-center justify-center rounded-2xl ${TONES[tone]}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
      </span>
      <h2 className="text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function ShareInvitation() {
  const { accessToken } = useAuth();
  const { t, date } = useI18n();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState({ loading: true, data: null, error: "", busy: false });

  useEffect(() => {
    if (!token) {
      setState({ loading: false, data: null, error: t("shareInvitation.notFound"), busy: false });
      return;
    }
    inspectVehicleShareInvitation(accessToken, token)
      .then((data) => setState({ loading: false, data, error: "", busy: false }))
      .catch((error) => setState({ loading: false, data: null, error: error.code === "SHARE_INVITATION_NOT_FOUND" ? t("shareInvitation.unknown") : error.message, busy: false }));
  }, [accessToken, token]);

  async function respond(action) {
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await respondVehicleShareInvitation(accessToken, token, action);
      setState((current) => ({ ...current, busy: false, data: { ...current.data, status: result.status } }));
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.code === "SHARE_INVITATION_NOT_FOUND" ? t("shareInvitation.unknown") : error.message }));
    }
  }

  const d = state.data;
  const primaryLink = "inline-flex min-h-12 items-center justify-center rounded-lg bg-fb-accent px-5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary";

  let content;
  if (state.loading) {
    content = <p role="status" className="rounded-2xl border border-fb-border bg-fb-main p-8 text-center text-fb-muted">{t("shareInvitation.checking")}</p>;
  } else if (!d) {
    content = (
      <StateCard icon="info" tone="neutral" title={t("shareInvitation.title")}>
        <p role="alert" className="text-fb-danger">{state.error}</p>
      </StateCard>
    );
  } else if (d.expired || d.status === "expired") {
    content = (
      <StateCard icon="expired" tone="warning" title={t("shareInvitation.expired")}>
        <p className="text-fb-muted">{t("shareInvitation.expiredHint")}</p>
        <Link to="/" className="inline-flex min-h-12 items-center rounded-lg border border-fb-border px-5 text-sm font-semibold hover:border-fb-accent">{t("nav.dashboard")}</Link>
      </StateCard>
    );
  } else if (d.status === "accepted") {
    content = (
      <StateCard icon="success" tone="success" title={t("shareInvitation.accepted")}>
        <p className="text-fb-muted">{t("shareInvitation.acceptedHint", { vehicle: d.vehicleName })}</p>
        <Link to="/vehicles" className={primaryLink}>{t("shareInvitation.toVehicles")}</Link>
      </StateCard>
    );
  } else if (d.status === "declined") {
    content = (
      <StateCard icon="info" tone="neutral" title={t("shareInvitation.declined")}>
        <p className="text-fb-muted">{t("shareInvitation.declinedHint")}</p>
      </StateCard>
    );
  } else if (!d.intendedForCurrentUser) {
    content = (
      <StateCard icon="info" tone="warning" title={t("shareInvitation.wrongUser")}>
        <p className="text-fb-muted">{t("shareInvitation.wrongUserHint")}</p>
      </StateCard>
    );
  } else {
    content = (
      <StateCard icon="vehicle" tone="accent" title={t("shareInvitation.request", { owner: d.ownerName })}>
        <dl className="grid w-full grid-cols-2 gap-3 rounded-xl bg-fb-surface p-4 text-left text-sm">
          <div><dt className="text-xs text-fb-muted">{t("shareInvitation.vehicle")}</dt><dd className="mt-0.5 font-semibold">{d.vehicleName}</dd></div>
          <div><dt className="text-xs text-fb-muted">{t("shareInvitation.validUntil", { date: "" }).replace(/\s*$/, "")}</dt><dd className="mt-0.5 font-semibold">{date(d.expiresAt, { dateStyle: "medium", timeStyle: "short" })}</dd></div>
        </dl>
        <p className="text-sm text-fb-muted">{t("shareInvitation.privacy")}</p>
        {state.error && <p role="alert" className="text-sm text-fb-danger">{state.error}</p>}
        <div className="flex w-full flex-wrap gap-3">
          <button type="button" disabled={state.busy} onClick={() => respond("accept")} className="min-h-12 flex-[2_1_12rem] rounded-lg bg-fb-accent px-5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-50">{t("vehicles.accept")}</button>
          <button type="button" disabled={state.busy} onClick={() => respond("decline")} className="min-h-12 flex-[1_1_8rem] rounded-lg border border-fb-border px-5 text-sm font-semibold hover:border-fb-accent disabled:opacity-50">{t("vehicles.decline")}</button>
        </div>
      </StateCard>
    );
  }

  return (
    <div className="mx-auto max-w-[512px] space-y-4 py-9">
      <p className="text-center text-sm font-semibold text-fb-accent-strong">{t("shareInvitation.section")}</p>
      {content}
    </div>
  );
}
