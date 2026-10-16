import { useCallback, useEffect, useState } from "react";

import {
  getAdminServiceSettings,
  runAdminServiceCheck,
  testAdminService,
  updateAdminAtlasSettings,
  updateAdminPhotonSettings,
  updateAdminSettings,
} from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft disabled:opacity-60";

const primaryButton =
  "rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60";

const secondaryButton =
  "rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:opacity-60";

const smallButton =
  "rounded-lg border border-fb-border px-3 py-1.5 text-xs font-semibold text-fb-text transition hover:border-fb-accent disabled:opacity-60";

const MODULE_ORDER = ["atlas", "geocoding", "mapMatching"];

const STATE_STYLES = {
  available: { label: "Verfügbar", className: "border-fb-accent bg-fb-accent-soft text-fb-accent-strong" },
  unavailable: { label: "Nicht erreichbar", className: "border-fb-danger text-fb-danger" },
  misconfigured: { label: "Unvollständig", className: "border-fb-danger text-fb-danger" },
  inactive: { label: "Inaktiv", className: "border-fb-border text-fb-muted" },
  checking: { label: "Prüfe …", className: "border-fb-border text-fb-muted" },
};

function errorText(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function StatusLine({ status }) {
  if (!status) return null;

  return (
    <div
      className={[
        "rounded-lg border px-3 py-2 text-sm",
        status.ok
          ? "border-fb-accent bg-fb-accent-soft text-fb-accent-strong"
          : "border-fb-danger text-fb-danger",
      ].join(" ")}
    >
      {status.text}
    </div>
  );
}

function StateBadge({ state }) {
  const style = STATE_STYLES[state] || STATE_STYLES.inactive;

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
      {style.label}
    </span>
  );
}

/** Systemcheck: welche Funktion ist mit den gespeicherten Einstellungen verfügbar? */
function SystemCheck({ results, checking, onCheck }) {
  return (
    <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Systemcheck</h2>
          <p className="mt-1 text-sm text-fb-muted">
            Prüft mit den gespeicherten Einstellungen, welche Funktionen
            verfügbar sind.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onCheck()}
          disabled={Object.values(checking).some(Boolean)}
          className={secondaryButton}
        >
          Alle prüfen
        </button>
      </div>

      <ul className="mt-5 divide-y divide-fb-border">
        {MODULE_ORDER.map((module) => {
          const result = results[module];
          const state = checking[module] ? "checking" : result?.state;

          return (
            <li key={module} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {result?.label || module}
                  </span>
                  {state && <StateBadge state={state} />}
                </div>
                {result && (
                  <div className="mt-1 text-xs text-fb-muted">
                    {result.state !== "inactive" && result.providerLabel && (
                      <span>{result.providerLabel} · </span>
                    )}
                    {result.message}
                    {result.responseTimeMs != null && (
                      <span> ({result.responseTimeMs} ms)</span>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onCheck(module)}
                disabled={checking[module]}
                className={smallButton}
              >
                Testen
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function GeocodingSettings() {
  const { accessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [checkResults, setCheckResults] = useState({});
  const [checking, setChecking] = useState({});

  const [atlas, setAtlas] = useState({ enabled: false, baseUrl: "", timeoutMs: 10_000 });
  const [atlasStatus, setAtlasStatus] = useState(null);
  const [atlasBusy, setAtlasBusy] = useState(false);

  const [photon, setPhoton] = useState({ provider: "public", baseUrl: "", timeoutMs: 10_000 });
  const [photonStatus, setPhotonStatus] = useState(null);
  const [photonBusy, setPhotonBusy] = useState(false);

  const [routing, setRouting] = useState({ provider: "disabled", osrmUrl: "", valhallaUrl: "" });
  const [routingStatus, setRoutingStatus] = useState(null);
  const [routingBusy, setRoutingBusy] = useState(false);

  const runCheck = useCallback(
    async (module) => {
      const modules = module ? [module] : MODULE_ORDER;
      setChecking((current) => ({ ...current, ...Object.fromEntries(modules.map((key) => [key, true])) }));

      try {
        const result = await runAdminServiceCheck(accessToken, module);
        setCheckResults((current) => ({
          ...current,
          ...Object.fromEntries(result.modules.map((entry) => [entry.module, entry])),
        }));
      } catch (error) {
        const message = errorText(error, "Der Systemcheck ist fehlgeschlagen.");
        setCheckResults((current) => ({
          ...current,
          ...Object.fromEntries(
            modules.map((key) => [key, { ...current[key], module: key, state: "unavailable", message }]),
          ),
        }));
      } finally {
        setChecking((current) => ({ ...current, ...Object.fromEntries(modules.map((key) => [key, false])) }));
      }
    },
    [accessToken],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const services = await getAdminServiceSettings(accessToken);
        if (cancelled) return;

        const savedPhoton = services.photon || {};
        const provider = savedPhoton.provider || "public";
        setPhoton({
          provider,
          // Öffentliche Standard-URL nicht als eigene Adresse vorbelegen
          baseUrl: provider === "public" ? "" : savedPhoton.baseUrl || "",
          timeoutMs: Number(savedPhoton.timeoutMs || 10_000),
        });
        setAtlas({
          enabled: Boolean(services.atlas?.enabled),
          baseUrl: services.atlas?.baseUrl || "",
          timeoutMs: Number(services.atlas?.timeoutMs || 10_000),
        });
        setRouting({
          provider: services.mapMatching?.provider || "disabled",
          osrmUrl: services.mapMatching?.osrmUrl || "",
          valhallaUrl: services.mapMatching?.valhallaUrl || "",
        });
      } catch (error) {
        if (!cancelled) {
          setLoadError(errorText(error, "Die Geocoding-Einstellungen konnten nicht geladen werden."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    runCheck();

    return () => {
      cancelled = true;
    };
  }, [accessToken, runCheck]);

  const atlasPayload = () => ({
    enabled: atlas.enabled,
    baseUrl: atlas.baseUrl.trim(),
    timeoutMs: Number(atlas.timeoutMs),
  });

  const photonPayload = () => ({
    provider: photon.provider,
    baseUrl: photon.provider === "custom" ? photon.baseUrl.trim() : photon.baseUrl.trim() || null,
    timeoutMs: Number(photon.timeoutMs),
  });

  const routingPayload = () => ({
    provider: routing.provider,
    osrmUrl: routing.osrmUrl.trim(),
    valhallaUrl: routing.valhallaUrl.trim(),
  });

  // Gemeinsamer Ablauf für Test- und Speichern-Buttons der drei Karten
  async function runAction(setBusy, setStatus, action, fallback, recheck) {
    setBusy(true);
    setStatus(null);

    try {
      const text = await action();
      setStatus({ ok: true, text });
      if (recheck) runCheck();
    } catch (error) {
      setStatus({ ok: false, text: errorText(error, fallback) });
    } finally {
      setBusy(false);
    }
  }

  const testCandidate = async (category, config) => {
    const result = await testAdminService(accessToken, category, { ...config, atlas: atlasPayload() });
    return `${result.message} (${result.responseTimeMs} ms)`;
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
        Geocoding-Einstellungen werden geladen …
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">
        {loadError}
      </div>
    );
  }

  const atlasReady = atlas.enabled && atlas.baseUrl.trim() !== "";

  return (
    <div className="space-y-8">
      <SystemCheck results={checkResults} checking={checking} onCheck={runCheck} />

      {/* Dawarich Atlas: Photon + Valhalla aus einem Container */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runAction(setAtlasBusy, setAtlasStatus, async () => {
            const saved = await updateAdminAtlasSettings(accessToken, atlasPayload());
            setAtlas({ enabled: saved.enabled, baseUrl: saved.baseUrl || "", timeoutMs: saved.timeoutMs });
            return "Die Atlas-Einstellungen wurden gespeichert.";
          }, "Die Atlas-Einstellungen konnten nicht gespeichert werden.", true);
        }}
        className="rounded-xl border border-fb-border bg-fb-main p-[22px]"
      >
        <h2 className="text-lg font-bold">Dawarich Atlas</h2>
        <p className="mt-1 text-sm text-fb-muted">
          Atlas bündelt Photon (Adresssuche) und Valhalla (Routing) in einer
          selbst gehosteten Installation. Wenn Atlas aktiv ist, kannst du
          Adresssuche und Map-Matching unten jeweils auf „über Atlas“ stellen –
          einzeln, beide oder keins.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
            <input
              type="checkbox"
              checked={atlas.enabled}
              onChange={(event) => setAtlas((current) => ({ ...current, enabled: event.target.checked }))}
              className="h-4 w-4 accent-fb-accent"
            />
            Atlas aktivieren
          </label>

          <label className="block text-sm font-medium">
            Atlas-Serveradresse
            <input
              type="url"
              required={atlas.enabled}
              placeholder="http://192.168.1.20:8484"
              value={atlas.baseUrl}
              onChange={(event) => setAtlas((current) => ({ ...current, baseUrl: event.target.value }))}
              className={fieldClass}
            />
            <span className="mt-1 block text-xs font-normal text-fb-muted">
              Basis-URL ohne /api/v1. Muss nur vom Fahrtenbuch-Backend erreichbar sein.
            </span>
          </label>

          <label className="block text-sm font-medium">
            Zeitlimit in Millisekunden
            <input
              type="number"
              min="1000"
              max="120000"
              step="500"
              value={atlas.timeoutMs}
              onChange={(event) => setAtlas((current) => ({ ...current, timeoutMs: Number(event.target.value) }))}
              className={fieldClass}
            />
          </label>
        </div>

        <div className="mt-6 space-y-4">
          <StatusLine status={atlasStatus} />
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              disabled={atlasBusy || !atlas.baseUrl.trim()}
              onClick={() =>
                runAction(setAtlasBusy, setAtlasStatus, () =>
                  testCandidate("atlas", { ...atlasPayload(), enabled: true }),
                "Atlas ist nicht erreichbar.")
              }
              className={secondaryButton}
            >
              Verbindung testen
            </button>
            <button type="submit" disabled={atlasBusy} className={primaryButton}>
              {atlasBusy ? "Bitte warten …" : "Atlas speichern"}
            </button>
          </div>
        </div>
      </form>

      {/* Photon: Adresssuche und Rückwärts-Geocoding */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runAction(setPhotonBusy, setPhotonStatus, async () => {
            await updateAdminPhotonSettings(accessToken, photonPayload());
            return "Die Einstellungen zur Adresssuche wurden gespeichert.";
          }, "Die Einstellungen zur Adresssuche konnten nicht gespeichert werden.", true);
        }}
        className="rounded-xl border border-fb-border bg-fb-main p-[22px]"
      >
        <h2 className="text-lg font-bold">Adresssuche (Photon)</h2>
        <p className="mt-1 text-sm text-fb-muted">
          Photon wandelt Adressen in Koordinaten um und ermittelt die Start- und
          Zieladressen von Fahrten. Deaktiviert bleiben Fahrten ohne
          automatische Adressen, die Adresssuche ist dann ausgeblendet.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Quelle
            <select
              value={photon.provider}
              onChange={(event) => setPhoton((current) => ({ ...current, provider: event.target.value }))}
              className={fieldClass}
            >
              <option value="disabled">Deaktiviert</option>
              <option value="public">Öffentlicher Server (photon.komoot.io)</option>
              <option value="custom">Eigener Photon-Server</option>
              <option value="atlas" disabled={!atlasReady && photon.provider !== "atlas"}>
                Über Dawarich Atlas{atlasReady ? "" : " (Atlas nicht aktiv)"}
              </option>
            </select>
          </label>

          {(photon.provider === "public" || photon.provider === "custom") && (
            <label className="block text-sm font-medium">
              Zeitlimit in Millisekunden
              <input
                type="number"
                min="1000"
                max="120000"
                step="500"
                value={photon.timeoutMs}
                onChange={(event) => setPhoton((current) => ({ ...current, timeoutMs: Number(event.target.value) }))}
                className={fieldClass}
              />
            </label>
          )}

          {photon.provider === "custom" && (
            <label className="block text-sm font-medium sm:col-span-2">
              Photon-Serveradresse
              <input
                type="url"
                required
                placeholder="http://192.168.1.12:2322"
                value={photon.baseUrl}
                onChange={(event) => setPhoton((current) => ({ ...current, baseUrl: event.target.value }))}
                className={fieldClass}
              />
              <span className="mt-1 block text-xs font-normal text-fb-muted">
                Basis-URL inklusive Protokoll und Port, ohne /api.
              </span>
            </label>
          )}

          {photon.provider === "atlas" && !atlasReady && (
            <p className="text-sm text-fb-danger sm:col-span-2">
              Atlas ist nicht aktiviert. Aktiviere und speichere Atlas oben, sonst bleibt die Adresssuche aus.
            </p>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <StatusLine status={photonStatus} />
          <div className="flex flex-wrap justify-end gap-3">
            {photon.provider !== "disabled" && (
              <button
                type="button"
                disabled={photonBusy}
                onClick={() =>
                  runAction(setPhotonBusy, setPhotonStatus, () =>
                    testCandidate("geocoding", photonPayload()),
                  "Der Photon-Server ist nicht erreichbar.")
                }
                className={secondaryButton}
              >
                Verbindung testen
              </button>
            )}
            <button type="submit" disabled={photonBusy} className={primaryButton}>
              {photonBusy ? "Bitte warten …" : "Adresssuche speichern"}
            </button>
          </div>
        </div>
      </form>

      {/* Valhalla/OSRM: Map-Matching der GPS-Spuren auf das Straßennetz */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runAction(setRoutingBusy, setRoutingStatus, async () => {
            // Nur mapMatching senden, damit die übrigen Systemeinstellungen unberührt bleiben
            const result = await updateAdminSettings(accessToken, { mapMatching: routingPayload() });
            if (result?.mapMatching) setRouting(result.mapMatching);
            return "Die Map-Matching-Einstellungen wurden gespeichert.";
          }, "Die Map-Matching-Einstellungen konnten nicht gespeichert werden.", true);
        }}
        className="rounded-xl border border-fb-border bg-fb-main p-[22px]"
      >
        <h2 className="text-lg font-bold">Map-Matching (Valhalla)</h2>
        <p className="mt-1 text-sm text-fb-muted">
          Legt aufgezeichnete GPS-Punkte auf das Straßennetz. Lücken in der
          Aufzeichnung werden entlang der Straße statt als Luftlinie
          geschlossen, dadurch stimmt die Distanz besser. Es gibt keinen
          öffentlichen Standardserver.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Quelle
            <select
              value={routing.provider}
              onChange={(event) => setRouting((current) => ({ ...current, provider: event.target.value }))}
              className={fieldClass}
            >
              <option value="disabled">Deaktiviert</option>
              <option value="valhalla">Eigener Valhalla-Server</option>
              <option value="osrm">Eigener OSRM-Server</option>
              <option value="atlas" disabled={!atlasReady && routing.provider !== "atlas"}>
                Über Dawarich Atlas{atlasReady ? "" : " (Atlas nicht aktiv)"}
              </option>
            </select>
          </label>

          {routing.provider === "valhalla" && (
            <label className="block text-sm font-medium sm:col-span-2">
              Valhalla-Serveradresse
              <input
                type="url"
                required
                placeholder="http://192.168.1.11:8002"
                value={routing.valhallaUrl}
                onChange={(event) => setRouting((current) => ({ ...current, valhallaUrl: event.target.value }))}
                className={fieldClass}
              />
              <span className="mt-1 block text-xs font-normal text-fb-muted">
                IP/Hostname inklusive Protokoll und Port. Der Standardport von Valhalla ist 8002.
              </span>
            </label>
          )}

          {routing.provider === "osrm" && (
            <label className="block text-sm font-medium sm:col-span-2">
              OSRM-Serveradresse
              <input
                type="url"
                required
                placeholder="http://192.168.1.10:5000"
                value={routing.osrmUrl}
                onChange={(event) => setRouting((current) => ({ ...current, osrmUrl: event.target.value }))}
                className={fieldClass}
              />
              <span className="mt-1 block text-xs font-normal text-fb-muted">
                IP/Hostname inklusive Protokoll und Port, z. B. http://192.168.1.10:5000
              </span>
            </label>
          )}

          {routing.provider === "atlas" && !atlasReady && (
            <p className="text-sm text-fb-danger sm:col-span-2">
              Atlas ist nicht aktiviert. Aktiviere und speichere Atlas oben, sonst bleibt Map-Matching aus.
            </p>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <StatusLine status={routingStatus} />
          <div className="flex flex-wrap justify-end gap-3">
            {routing.provider !== "disabled" && (
              <button
                type="button"
                disabled={routingBusy}
                onClick={() =>
                  runAction(setRoutingBusy, setRoutingStatus, () =>
                    testCandidate("mapMatching", routingPayload()),
                  "Der Routing-Server ist nicht erreichbar.")
                }
                className={secondaryButton}
              >
                Verbindung testen
              </button>
            )}
            <button type="submit" disabled={routingBusy} className={primaryButton}>
              {routingBusy ? "Bitte warten …" : "Map-Matching speichern"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
