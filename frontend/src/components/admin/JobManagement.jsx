import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { getJobStatus, getAdminJobs, retryAdminJob, deleteAdminJob } from "../../api/app.js";
import { useI18n } from "../../i18n/I18nProvider.jsx";

const states = ["pending", "processing", "delayed", "failed"];

export default function JobManagement() {
  const { accessToken } = useAuth();
  const { t } = useI18n();
  const [state, setState] = useState("failed");
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const [info, result] = await Promise.all([getJobStatus(accessToken), getAdminJobs(accessToken, state)]);
      setStatus(info);
      setJobs(result.jobs || []);
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

  return <section className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">{t("jobs.title")}</h2><p className="text-sm text-fb-muted">{t("jobs.description")}</p></div>
      <button type="button" onClick={refresh} className="rounded-lg border border-fb-border px-3 py-2 text-sm">{t("jobs.refresh")}</button>
    </header>
    <div className="rounded-xl border border-fb-border bg-fb-main p-4 text-sm">
      {t("jobs.redis")}: <strong>{status?.online ? t("jobs.online") : t("jobs.offline")}</strong>
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
