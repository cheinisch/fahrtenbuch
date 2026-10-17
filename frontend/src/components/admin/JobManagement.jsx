import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { getJobStatus, getAdminJobs, retryAdminJob, deleteAdminJob, startReverseGeocodeJobs, getMapMatchingStatus, startMapMatchingJobs, getMapMatchingIssues } from "../../api/app.js";
import { useI18n } from "../../i18n/I18nProvider.jsx";

const states = ["pending", "processing", "delayed", "failed"];

export default function JobManagement() {
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();
  const [state, setState] = useState("failed");
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [geocodeMode, setGeocodeMode] = useState("missing");
  const [notice, setNotice] = useState("");
  const [matchMode, setMatchMode] = useState("missing");
  const [matchInfo, setMatchInfo] = useState(null);
  const [matchNotice, setMatchNotice] = useState("");
  const [issueFilter, setIssueFilter] = useState(null);
  const [issues, setIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [info, result, matching] = await Promise.all([
        getJobStatus(accessToken),
        getAdminJobs(accessToken, state),
        getMapMatchingStatus(accessToken).catch(() => null),
      ]);
      setStatus(info);
      setJobs(result.jobs || []);
      setMatchInfo(matching);
      setError("");
    } catch (err) { setError(err.message); }
  }, [accessToken, state]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const action = async (job, operation) => {
    if (operation === "delete" && !window.confirm(t("jobs.confirmDelete"))) return;
    setBusy(job.id);
    try {
      if (operation === "retry") await retryAdminJob(accessToken, job.id);
      else await deleteAdminJob(accessToken, job.id);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  };

  const startGeocoding = async () => {
    setBusy("geocode");
    setNotice("");
    try {
      const result = await startReverseGeocodeJobs(accessToken, geocodeMode);
      setNotice(t("jobs.queuedMessage").replace("{count}", result.queued));
      setState("pending");
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  };

  // Abgelehnte/fehlgeschlagene Fahrten mit Grund anzeigen
  const toggleIssues = async (status) => {
    if (issueFilter === status) { setIssueFilter(null); return; }
    setIssueFilter(status);
    setIssuesLoading(true);
    try {
      const result = await getMapMatchingIssues(accessToken, status);
      setIssues(result.trips || []);
    } catch (err) { setError(err.message); setIssues([]); }
    finally { setIssuesLoading(false); }
  };

  const fmtKm = (meters) => meters == null ? "–"
    : `${(meters / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
  const fmtDate = (value, timeZone) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(value));
    } catch { return new Date(value).toLocaleString(locale); }
  };

  const startMatching = async () => {
    setBusy("match");
    setMatchNotice("");
    try {
      const result = await startMapMatchingJobs(accessToken, matchMode);
      setMatchNotice(result.selected ? t("jobs.queuedMessage").replace("{count}", result.queued) : t("jobs.matchNothing"));
      setState("pending");
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  };

  const insightPort = status?.redisInsight?.port || 5540;
  // Ohne REDIS_INSIGHT_URL nur auf dem Docker-Host bzw. per SSH-Tunnel erreichbar
  const insightUrl = status?.redisInsight?.url || `http://localhost:${insightPort}`;

  const providerName = { atlas: t("jobs.providerAtlas"), valhalla: t("jobs.providerValhalla"), osrm: t("jobs.providerOsrm") };
  const matchCounts = [
    ["missing", t("jobs.matchOpen")],
    ["applied", t("jobs.matchApplied")],
    ["rejected", t("jobs.matchRejected")],
    ["failed", t("jobs.matchFailedCount")],
  ];

  return <section className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">{t("jobs.title")}</h2><p className="text-sm text-fb-muted">{t("jobs.description")}</p></div>
      <button type="button" onClick={refresh} className="rounded-lg border border-fb-border px-3 py-2 text-sm">{t("jobs.refresh")}</button>
    </header>
    <div className="rounded-xl border border-fb-border bg-fb-main p-4">
      <h3 className="font-semibold">{t("jobs.geocodeTitle")}</h3>
      <p className="mt-1 text-sm text-fb-muted">{t("jobs.geocodeDescription")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select aria-label={t("jobs.geocodeMode")} value={geocodeMode} onChange={(event) => setGeocodeMode(event.target.value)}
          className="rounded-lg border border-fb-border bg-fb-surface px-3 py-2 text-sm text-fb-text">
          <option value="missing">{t("jobs.geocodeMissing")}</option>
          <option value="all">{t("jobs.geocodeAll")}</option>
        </select>
        <button type="button" disabled={busy === "geocode"} onClick={startGeocoding}
          className="rounded-lg bg-fb-accent px-4 py-2 text-sm font-semibold text-fb-accent-text disabled:opacity-50">
          {busy === "geocode" ? t("jobs.starting") : t("jobs.startGeocode")}
        </button>
      </div>
      {notice && <p role="status" className="mt-3 text-sm text-fb-accent">{notice}</p>}
    </div>
    <div className="rounded-xl border border-fb-border bg-fb-main p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{t("jobs.matchTitle")}</h3>
        {matchInfo?.enabled && <span className="text-xs text-fb-muted">{t("jobs.matchVia")}: {providerName[matchInfo.provider] || matchInfo.provider}</span>}
      </div>
      <p className="mt-1 text-sm text-fb-muted">{t("jobs.matchDescription")}</p>
      {matchInfo && <dl className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        {matchCounts.map(([key, label]) => {
          const count = matchInfo.trips?.[key] ?? 0;
          const clickable = (key === "rejected" || key === "failed") && count > 0;
          return <div key={key} className="flex items-center gap-1.5">
            <dt className="text-fb-muted">{label}:</dt>
            <dd className="font-semibold">
              {clickable
                ? <button type="button" onClick={() => toggleIssues(key)} aria-expanded={issueFilter === key}
                    className="rounded px-1 text-fb-accent-strong underline underline-offset-2 hover:bg-fb-accent-soft">
                    {count} · {issueFilter === key ? t("jobs.issuesHide") : t("jobs.issuesShow")}
                  </button>
                : count}
            </dd>
          </div>;
        })}
      </dl>}
      {issueFilter && <div className="mt-3 overflow-x-auto rounded-lg border border-fb-border">
        {issuesLoading
          ? <p className="p-4 text-sm text-fb-muted">{t("jobs.issuesLoading")}</p>
          : !issues.length
            ? <p className="p-4 text-sm text-fb-muted">{t("jobs.issuesEmpty")}</p>
            : <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="border-b border-fb-border text-xs text-fb-muted">
                <th className="p-2.5">{t("jobs.issueTrip")}</th>
                <th className="p-2.5">{t("jobs.issueUser")}</th>
                <th className="p-2.5">{t("jobs.issueDistance")}</th>
                <th className="p-2.5">{t("jobs.issueReason")}</th>
              </tr></thead>
              <tbody>{issues.map((issue) => <tr key={issue.tripId} className="border-b border-fb-border align-top last:border-0">
                <td className="p-2.5">
                  <div className="font-medium">{fmtDate(issue.startedAt, issue.timeZone)}</div>
                  <div className="text-xs text-fb-muted">{issue.startAddress || "–"} → {issue.endAddress || "–"}</div>
                </td>
                <td className="p-2.5">{issue.user?.displayName || issue.user?.username || "–"}</td>
                <td className="whitespace-nowrap p-2.5">
                  <div>{t("jobs.issueGps")}: {fmtKm(issue.rawDistanceMeters)}</div>
                  {issue.matchedDistanceMeters != null && <div className="text-xs text-fb-muted">{t("jobs.issueMatched")}: {fmtKm(issue.matchedDistanceMeters)}</div>}
                  <div className="text-xs text-fb-muted">{issue.pointCount} {t("jobs.issuePoints")}</div>
                </td>
                <td className="p-2.5">{issue.message || "–"}</td>
              </tr>)}</tbody>
            </table>}
      </div>}
      {matchInfo && !matchInfo.enabled
        ? <p className="mt-3 rounded-lg border border-fb-border bg-fb-surface p-3 text-sm text-fb-muted">{t("jobs.matchDisabled")}</p>
        : <div className="mt-3 flex flex-wrap items-center gap-3">
          <select aria-label={t("jobs.matchMode")} value={matchMode} onChange={(event) => setMatchMode(event.target.value)}
            className="rounded-lg border border-fb-border bg-fb-surface px-3 py-2 text-sm text-fb-text">
            <option value="missing">{t("jobs.matchMissing")}</option>
            <option value="failed">{t("jobs.matchFailed")}</option>
            <option value="all">{t("jobs.matchAll")}</option>
          </select>
          <button type="button" disabled={busy === "match" || !matchInfo} onClick={startMatching}
            className="rounded-lg bg-fb-accent px-4 py-2 text-sm font-semibold text-fb-accent-text disabled:opacity-50">
            {busy === "match" ? t("jobs.starting") : t("jobs.startMatch")}
          </button>
        </div>}
      {matchNotice && <p role="status" className="mt-3 text-sm text-fb-accent">{matchNotice}</p>}
    </div>
    <div className="rounded-xl border border-fb-border bg-fb-main p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {t("jobs.redis")}: <strong>{status?.online ? t("jobs.online") : t("jobs.offline")}</strong>
          <span className="ml-2 text-fb-muted">redis:6379</span>
        </div>
        <a href={insightUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center rounded-lg border border-fb-border px-3 font-semibold hover:border-fb-accent">
          {t("jobs.insightOpen")}
        </a>
      </div>
      <p className="mt-2 text-xs text-fb-muted">
        {status?.redisInsight?.url
          ? t("jobs.insightConfigured")
          : t("jobs.insightLocal").replaceAll("{port}", insightPort)}
      </p>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {states.map((item) => <button key={item} type="button" onClick={() => setState(item)}
        className={"rounded-xl border p-4 text-left " + (state === item ? "border-fb-accent bg-fb-accent-soft" : "border-fb-border bg-fb-main")}>
        <span className="block text-xs text-fb-muted">{t("jobs." + item)}</span>
        <strong className="mt-1 block text-2xl">{status?.counts?.[item] ?? "–"}</strong>
      </button>)}
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-500">{error}</p>}
    <div className="overflow-x-auto rounded-xl border border-fb-border bg-fb-main">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-fb-border text-fb-muted">
          <th className="p-3">{t("jobs.type")}</th><th className="p-3">{t("jobs.id")}</th>
          <th className="p-3">{t("jobs.attempts")}</th><th className="p-3">{t("jobs.error")}</th>
          <th className="p-3">{t("jobs.actions")}</th>
        </tr></thead>
        <tbody>{jobs.map((job, index) => <tr key={job.id || index} className="border-b border-fb-border">
          <td className="p-3">{job.type}</td><td className="p-3 font-mono text-xs">{job.id || "–"}</td>
          <td className="p-3">{job.attempt ?? 0}</td><td className="max-w-xs break-words p-3">{job.error || "–"}</td>
          <td className="p-3">{state === "failed" && job.id && <div className="flex gap-2">
            <button type="button" disabled={busy === job.id} onClick={() => action(job, "retry")} className="rounded border border-fb-border px-2 py-1">{t("jobs.retry")}</button>
            <button type="button" disabled={busy === job.id} onClick={() => action(job, "delete")} className="rounded border border-red-500 px-2 py-1 text-red-500">{t("jobs.delete")}</button>
          </div>}</td>
        </tr>)}</tbody>
      </table>
      {!jobs.length && <p className="p-5 text-center text-sm text-fb-muted">{t("jobs.empty")}</p>}
    </div>
  </section>;
}
