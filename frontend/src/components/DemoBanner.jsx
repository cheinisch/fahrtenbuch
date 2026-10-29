import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../i18n/I18nProvider.jsx";

// Nur in der öffentlichen Demo: Der Server setzt <meta name="fahrtenbuch-demo"> mit der
// Statusadresse des Demo-Spawners (DEMO_STATUS_URL). Ohne Meta-Tag rendert nichts.
function demoStatusUrl() {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="fahrtenbuch-demo"]')?.getAttribute("content") || null;
}

function formatRemaining(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export default function DemoBanner() {
  const { t } = useI18n();
  const [statusUrl] = useState(demoStatusUrl);
  const [status, setStatus] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!statusUrl) return;
    try {
      const response = await fetch(statusUrl, { cache: "no-store" });
      if (response.ok) setStatus(await response.json());
    } catch {
      // Spawner kurz nicht erreichbar: alten Stand weiter anzeigen
    }
  }, [statusUrl]);

  useEffect(() => {
    if (!statusUrl) return undefined;
    load();
    const poll = setInterval(load, 30000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [statusUrl, load]);

  if (!statusUrl || !status?.expires) return null;

  const remaining = status.expires - now / 1000;
  const expired = remaining <= 0;
  const warn = remaining < 120;

  async function extend() {
    setBusy(true);
    try {
      const response = await fetch(`${statusUrl}/extend`, { method: "POST" });
      if (response.ok) setStatus(await response.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-4">
      <div
        role="status"
        className={`pointer-events-auto flex flex-wrap items-center gap-3 rounded-full border px-4 py-2 text-sm shadow-lg ${
          warn ? "border-fb-warn bg-fb-warn-soft text-fb-warn" : "border-fb-border bg-fb-main text-fb-text"
        }`}
      >
        {expired ? (
          <>
            <span className="font-semibold">{t("demo.expired")}</span>
            {/* Ohne Unterpfad: die Startseite des Spawners liegt im Wurzelverzeichnis */}
            <a href="/" className="font-semibold text-fb-accent-strong hover:underline">{t("demo.newDemo")}</a>
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums">{t("demo.remaining", { time: formatRemaining(remaining) })}</span>
            {status.extendable ? (
              <button
                type="button"
                onClick={extend}
                disabled={busy}
                className="rounded-full bg-fb-accent px-3 py-1 text-xs font-semibold text-fb-accent-text hover:opacity-90 disabled:opacity-60"
              >
                {busy ? t("demo.extending") : t("demo.extend", { minutes: status.extendMinutes })}
              </button>
            ) : (
              status.extended && <span className="text-xs text-fb-muted">{t("demo.extended")}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
