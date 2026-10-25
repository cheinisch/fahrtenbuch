import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";
import {
  deleteDawarichConnection,
  getDawarichConnection,
  saveDawarichConnection,
  testDawarichConnection,
} from "../../api/app.js";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";
const labelClass = "block text-sm font-medium text-fb-text";
const secondaryButton =
  "rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold hover:border-fb-accent disabled:opacity-60";

/**
 * Profilabschnitt „Dawarich“: Adresse und API-Key der eigenen Dawarich-Instanz.
 * Der Server prüft die Daten vor dem Speichern; der Key wird nie wieder angezeigt.
 */
export default function DawarichConnectionSection({ accessToken, onSuccess, onError }) {
  const { t, locale } = useI18n();
  const [connection, setConnection] = useState({ connected: false });
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let active = true;
    getDawarichConnection(accessToken)
      .then((value) => {
        if (!active) return;
        setConnection(value);
        setBaseUrl(value.baseUrl || "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessToken]);

  async function run(kind, action, successText) {
    setBusy(kind);
    try {
      await action();
      onSuccess(successText);
    } catch (error) {
      onError(error);
    } finally {
      setBusy("");
    }
  }

  function save(event) {
    event.preventDefault();
    run("save", async () => {
      const value = await saveDawarichConnection(accessToken, { baseUrl, apiKey: apiKey.trim() || null });
      setConnection(value);
      setBaseUrl(value.baseUrl || "");
      setApiKey("");
    }, t("profile.dawarich.saved"));
  }

  function test() {
    run("test", async () => {
      setConnection(await testDawarichConnection(accessToken));
    }, t("profile.dawarich.testOk"));
  }

  function disconnect() {
    if (!window.confirm(t("profile.dawarich.disconnectConfirm"))) return;
    run("delete", async () => {
      await deleteDawarichConnection(accessToken);
      setConnection({ connected: false });
      setBaseUrl("");
      setApiKey("");
    }, t("profile.dawarich.disconnected"));
  }

  const verifiedAt = connection.verifiedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.verifiedAt))
    : null;

  return (
    <form onSubmit={save}>
      <section id="section-dawarich" data-section="dawarich" className="scroll-mt-6 rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <div className="mb-4">
          <h2 className="text-lg font-bold">{t("profile.dawarich.title")}</h2>
          <p className="mt-1 text-sm text-fb-muted">{t("profile.dawarich.description")}</p>
        </div>

        {connection.connected && (
          <div className="mb-4 rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm">
            <div className="font-semibold">
              {connection.lastError ? t("profile.dawarich.statusError") : t("profile.dawarich.statusConnected")}
            </div>
            <div className="mt-1 text-fb-muted">
              {[
                connection.email,
                connection.version && t("profile.dawarich.version", { version: connection.version }),
                verifiedAt && t("profile.dawarich.verifiedAt", { date: verifiedAt }),
              ].filter(Boolean).join(" · ")}
            </div>
            {connection.lastError && <div className="mt-1 text-fb-danger">{connection.lastError}</div>}
          </div>
        )}

        <label className={labelClass} htmlFor="profile-dawarich-url">{t("profile.dawarich.url")}</label>
        <input
          id="profile-dawarich-url"
          type="url"
          required
          className={fieldClass}
          placeholder="https://dawarich.example.com"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />

        <label className={`${labelClass} mt-4`} htmlFor="profile-dawarich-key">{t("profile.dawarich.apiKey")}</label>
        <input
          id="profile-dawarich-key"
          type="password"
          autoComplete="off"
          required={!connection.connected}
          className={fieldClass}
          placeholder={connection.connected && connection.apiKeyHint
            ? t("profile.dawarich.apiKeyKeep", { hint: connection.apiKeyHint })
            : ""}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <p className="mt-2 text-sm text-fb-muted">{t("profile.dawarich.hint")}</p>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {connection.connected && (
            <>
              <button type="button" onClick={disconnect} disabled={Boolean(busy)} className={secondaryButton}>
                {t("profile.dawarich.disconnect")}
              </button>
              <button type="button" onClick={test} disabled={Boolean(busy)} className={secondaryButton}>
                {busy === "test" ? t("profile.dawarich.testing") : t("profile.dawarich.test")}
              </button>
            </>
          )}
          <button type="submit" disabled={Boolean(busy)} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">
            {busy === "save" ? t("common.saving") : connection.connected ? t("common.save") : t("profile.dawarich.connect")}
          </button>
        </div>
      </section>
    </form>
  );
}
