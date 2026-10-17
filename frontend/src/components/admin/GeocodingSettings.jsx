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
  "min-h-11 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60";

const secondaryButton =
  "min-h-11 rounded-lg border border-fb-border px-4 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:opacity-60";

const MODULE_ORDER = ["atlas", "geocoding", "mapMatching"];

const MODULE_LABELS = {
  atlas: "Dawarich Atlas",
  geocoding: "Adresssuche (Photon)",
  mapMatching: "Map-Matching (Valhalla)",
};

// Icon-Pfade (24er Raster, Strich) je Modul
const MODULE_ICONS = {
  atlas: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20",
  geocoding: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M21 21l-4.3-4.3",
  mapMatching: "M6 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4M18 9a2 2 0 1 0 0-4a2 2 0 1 0 0 4M8 17h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5",
};

const STATE_STYLES = {
  available: { label: "Verfügbar", className: "border-transparent bg-fb-accent-soft text-fb-accent-strong" },
  starting: { label: "Startet", className: "border-transparent bg-fb-warn-soft text-fb-warn" },
  unavailable: { label: "Nicht erreichbar", className: "border-fb-danger text-fb-danger" },
  misconfigured: { label: "Unvollständig", className: "border-fb-danger text-fb-danger" },
  inactive: { label: "Inaktiv", className: "border-fb-border bg-fb-surface text-fb-muted" },
  checking: { label: "Prüfe …", className: "border-fb-border text-fb-muted" },
};

const CAPABILITY_LABELS = { geocoding: "Geocoding", routing: "Routing", pois: "POIs", transit: "ÖPNV" };

const CAPABILITY_STYLES = {
  up: { text: "aktiv", className: "bg-fb-accent-soft font-semibold text-fb-accent-strong" },
  starting: { text: "startet", className: "bg-fb-warn-soft font-semibold text-fb-warn" },
  down: { text: "aus", className: "border border-fb-border bg-fb-surface text-fb-muted" },
};

const PHOTON_OPTIONS = [
  { value: "disabled", title: "Deaktiviert", hint: "Keine automatischen Adressen, Suche ausgeblendet" },
  { value: "public", title: "Öffentlicher Server", hint: "photon.komoot.io – ohne eigene Infrastruktur" },
  { value: "custom", title: "Eigener Photon-Server", hint: "Eigene Adresse, z. B. http://192.168.1.12:2322" },
  { value: "atlas", title: "Über Dawarich Atlas", hint: "Nutzt den Photon-Passthrough von Atlas", needsAtlas: true },
];

const ROUTING_OPTIONS = [
  { value: "disabled", title: "Deaktiviert", hint: "Distanz aus den GPS-Punkten, Lücken als Luftlinie" },
  { value: "valhalla", title: "Eigener Valhalla-Server", hint: "Eigene Adresse, Standardport 8002" },
  { value: "osrm", title: "Eigener OSRM-Server", hint: "Eigene Adresse, z. B. http://192.168.1.10:5000" },
  { value: "atlas", title: "Über Dawarich Atlas", hint: "Nutzt das Valhalla-Map-Matching von Atlas", needsAtlas: true },
];

function errorText(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function formatCheckedAt(value) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusLine({ status }) {
  if (!status) return null;

  const className = {
    ok: "border-fb-accent bg-fb-accent-soft text-fb-accent-strong",
    warn: "border-fb-warn bg-fb-warn-soft text-fb-warn",
    error: "border-fb-danger text-fb-danger",
  }[status.kind];

  return (
    <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${className}`}>
      {status.text}
    </div>
  );
}

function StateBadge({ state }) {
  const style = STATE_STYLES[state] || STATE_STYLES.inactive;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
      <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-current" />
      {style.label}
    </span>
  );
}

function ModuleIcon({ module }) {
  return (
    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-fb-surface">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-fb-muted">
        <path d={MODULE_ICONS[module]} />
      </svg>
    </div>
  );
}

/** Systemcheck: welche Funktion ist mit den gespeicherten Einstellungen verfügbar? */
function SystemCheck({ results, checking, checkedAt, onCheck }) {
  const anyChecking = Object.values(checking).some(Boolean);

  return (
    <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Systemcheck</h2>
          <p className="mt-1 text-sm text-fb-muted">
            Prüft mit den gespeicherten Einstellungen, welche Funktionen verfügbar sind.
            {checkedAt && <> Zuletzt geprüft um {formatCheckedAt(checkedAt)} Uhr.</>}
          </p>
        </div>
        <button type="button" onClick={() => onCheck()} disabled={anyChecking} className={secondaryButton}>
          Alle prüfen
        </button>
      </div>

      <ul className="mt-[18px]">
        {MODULE_ORDER.map((module) => {
          const result = results[module];
          const state = checking[module] ? "checking" : result?.state;

          return (
            <li key={module} className="flex flex-wrap items-center gap-3.5 border-t border-fb-border py-3.5">
              <ModuleIcon module={module} />
              <div className="min-w-0 flex-[1_1_320px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{MODULE_LABELS[module]}</span>
                  {state && <StateBadge state={state} />}
                </div>
                {result && (
                  <div className="mt-0.5 text-[13px] text-fb-muted">
                    {result.state !== "inactive" && result.providerLabel && <>{result.providerLabel} · </>}
                    {result.message}
                  </div>
                )}
              </div>
              <div className="min-w-[60px] text-right text-[13px] text-fb-muted">
                {result?.responseTimeMs != null ? `${result.responseTimeMs} ms` : "–"}
              </div>
              <button
                type="button"
                onClick={() => onCheck(module)}
                disabled={checking[module]}
                aria-label={`${MODULE_LABELS[module]} testen`}
                className="min-h-9 rounded-lg border border-fb-border px-3.5 text-[13px] font-semibold text-fb-text transition hover:border-fb-accent disabled:opacity-60"
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

/** Auswahlkarten statt Dropdown: jede Quelle erklärt sich selbst. */
function SourcePicker({ name, options, value, atlasReady, onChange, children }) {
  return (
    <fieldset className="mt-5">
      <legend className="text-sm font-medium">Quelle</legend>
      <div className="mt-2 flex flex-col gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          const disabled = option.needsAtlas && !atlasReady && !selected;

          return (
            <div key={option.value}>
              <label
                className={[
                  "flex items-start gap-3 rounded-lg border px-3.5 py-3 transition",
                  selected ? "border-fb-accent bg-fb-accent-soft" : "border-fb-border",
                  disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-fb-accent",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onChange(option.value)}
                  className="mt-1 h-4 w-4 flex-none accent-fb-accent"
                />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="block text-xs text-fb-muted">
                    {disabled ? "Erst Dawarich Atlas oben aktivieren und speichern" : option.hint}
                  </span>
                </span>
              </label>
              {selected && children?.(option.value)}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function CapabilityChips({ details }) {
  if (!details) return null;
  const capabilities = details.capabilities || {};

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {details.version && (
        <span className="rounded-lg border border-fb-border bg-fb-surface px-2.5 py-1 text-xs text-fb-muted">
          Atlas {details.version}
        </span>
      )}
      {Object.entries(CAPABILITY_LABELS)
        .filter(([key]) => capabilities[key])
        .map(([key, label]) => {
          const style = CAPABILITY_STYLES[capabilities[key]] || CAPABILITY_STYLES.down;
          return (
            <span key={key} className={`rounded-lg px-2.5 py-1 text-xs ${style.className}`}>
              {label}: {style.text}
            </span>
          );
        })}
    </div>
  );
}

export default function GeocodingSettings() {
  const { accessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [checkResults, setCheckResults] = useState({});
  const [checking, setChecking] = useState({});
  const [checkedAt, setCheckedAt] = useState(null);

  const [atlas, setAtlas] = useState({ enabled: false, baseUrl: "", timeoutMs: 10_000 });
  const [atlasSaved, setAtlasSaved] = useState(false);
  const [atlasDetails, setAtlasDetails] = useState(null);
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
      const flag = (value) => Object.fromEntries(modules.map((key) => [key, value]));
      setChecking((current) => ({ ...current, ...flag(true) }));

      try {
        const result = await runAdminServiceCheck(accessToken, module);
        setCheckedAt(result.checkedAt);
        setCheckResults((current) => ({
          ...current,
          ...Object.fromEntries(result.modules.map((entry) => [entry.module, entry])),
        }));
        const atlasResult = result.modules.find((entry) => entry.module === "atlas");
        if (atlasResult) setAtlasDetails(atlasResult.details);
      } catch (error) {
        const message = errorText(error, "Der Systemcheck ist fehlgeschlagen.");
        setCheckResults((current) => ({
          ...current,
          ...Object.fromEntries(modules.map((key) => [key, { ...current[key], module: key, state: "unavailable", message }])),
        }));
      } finally {
        setChecking((current) => ({ ...current, ...flag(false) }));
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
        setAtlasSaved(Boolean(services.atlas?.enabled && services.atlas?.baseUrl));
        setRouting({
          provider: services.mapMatching?.provider || "disabled",
          osrmUrl: services.mapMatching?.osrmUrl || "",
          valhallaUrl: services.mapMatching?.valhallaUrl || "",
        });
      } catch (error) {
        if (!cancelled) setLoadError(errorText(error, "Die Geocoding-Einstellungen konnten nicht geladen werden."));
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
    // Öffentlich: Server setzt photon.komoot.io; sonst eigene Adresse für späteres Umschalten behalten
    baseUrl: photon.provider === "public" ? null : photon.baseUrl.trim() || null,
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
      const result = await action();
      setStatus(typeof result === "string" ? { kind: "ok", text: result } : result);
      if (recheck) runCheck();
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error, fallback) });
    } finally {
      setBusy(false);
    }
  }

  const testCandidate = async (category, config) => {
    const result = await testAdminService(accessToken, category, { ...config, atlas: atlasPayload() });
    if (category === "atlas") setAtlasDetails(result.details || null);
    const time = result.responseTimeMs != null ? ` (${result.responseTimeMs} ms)` : "";
    return { kind: result.state === "starting" ? "warn" : "ok", text: `${result.message}${time}` };
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

  // „Über Atlas“ erst anbieten, wenn Atlas gespeichert aktiv ist – sonst würde
  // die Auswahl serverseitig ins Leere laufen.
  const atlasReady = atlasSaved;

  const timeoutField = (value, onChange) => (
    <label className="block text-sm font-medium">
      Zeitlimit in Millisekunden
      <input type="number" min="1000" max="120000" step="500" value={value} onChange={onChange} className={fieldClass} />
    </label>
  );

  return (
    <div className="space-y-8">
      <SystemCheck results={checkResults} checking={checking} checkedAt={checkedAt} onCheck={runCheck} />

      {/* Dawarich Atlas: Photon + Valhalla aus einem Container */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runAction(setAtlasBusy, setAtlasStatus, async () => {
            const saved = await updateAdminAtlasSettings(accessToken, atlasPayload());
            setAtlas({ enabled: saved.enabled, baseUrl: saved.baseUrl || "", timeoutMs: saved.timeoutMs });
            setAtlasSaved(Boolean(saved.enabled && saved.baseUrl));
            return "Die Atlas-Einstellungen wurden gespeichert.";
          }, "Die Atlas-Einstellungen konnten nicht gespeichert werden.", true);
        }}
        className="rounded-xl border border-fb-border bg-fb-main p-[22px]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[720px]">
            <h2 className="text-lg font-bold">Dawarich Atlas</h2>
            <p className="mt-1 text-sm text-fb-muted">
              Atlas bündelt Photon (Adresssuche) und Valhalla (Routing) in einer selbst gehosteten
              Installation. Ist Atlas aktiv, lassen sich Adresssuche und Map-Matching unten einzeln
              auf „Über Atlas“ stellen.
            </p>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-semibold">
            <input
              type="checkbox"
              role="switch"
              checked={atlas.enabled}
              onChange={(event) => setAtlas((current) => ({ ...current, enabled: event.target.checked }))}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="relative inline-block h-6 w-11 rounded-full bg-fb-border transition peer-checked:bg-fb-accent peer-focus-visible:ring-2 peer-focus-visible:ring-fb-accent-soft after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-white after:transition peer-checked:after:left-[23px]"
            />
            {atlas.enabled ? "Aktiv" : "Inaktiv"}
          </label>
        </div>

        <div className="mt-[22px] grid gap-5 sm:grid-cols-2">
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
              Basis-URL ohne /api/v1. Muss nur vom Backend erreichbar sein.
            </span>
          </label>
          {timeoutField(atlas.timeoutMs, (event) => setAtlas((current) => ({ ...current, timeoutMs: Number(event.target.value) })))}
        </div>

        <CapabilityChips details={atlasDetails} />

        <div className="mt-[22px] space-y-4">
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

      <div className="grid items-start gap-6 lg:grid-cols-2">
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
            Wandelt Adressen in Koordinaten um und ermittelt Start- und Zieladressen von Fahrten.
          </p>

          <SourcePicker
            name="photon-source"
            options={PHOTON_OPTIONS}
            value={photon.provider}
            atlasReady={atlasReady}
            onChange={(provider) => setPhoton((current) => ({ ...current, provider }))}
          >
            {(selected) =>
              (selected === "public" || selected === "custom") && (
                <div className="mt-3 grid gap-4 rounded-lg border border-fb-border p-3.5">
                  {selected === "custom" && (
                    <label className="block text-sm font-medium">
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
                  {timeoutField(photon.timeoutMs, (event) => setPhoton((current) => ({ ...current, timeoutMs: Number(event.target.value) })))}
                </div>
              )
            }
          </SourcePicker>

          <div className="mt-4 space-y-4">
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
            Legt GPS-Punkte auf das Straßennetz, damit Lücken entlang der Straße statt als Luftlinie
            geschlossen werden. Gestartet wird es unter „Hintergrundaufgaben“.
          </p>

          <SourcePicker
            name="routing-source"
            options={ROUTING_OPTIONS}
            value={routing.provider}
            atlasReady={atlasReady}
            onChange={(provider) => setRouting((current) => ({ ...current, provider }))}
          >
            {(selected) =>
              (selected === "valhalla" || selected === "osrm") && (
                <div className="mt-3 rounded-lg border border-fb-border p-3.5">
                  <label className="block text-sm font-medium">
                    {selected === "valhalla" ? "Valhalla-Serveradresse" : "OSRM-Serveradresse"}
                    <input
                      type="url"
                      required
                      placeholder={selected === "valhalla" ? "http://192.168.1.11:8002" : "http://192.168.1.10:5000"}
                      value={selected === "valhalla" ? routing.valhallaUrl : routing.osrmUrl}
                      onChange={(event) =>
                        setRouting((current) => ({
                          ...current,
                          [selected === "valhalla" ? "valhallaUrl" : "osrmUrl"]: event.target.value,
                        }))
                      }
                      className={fieldClass}
                    />
                    <span className="mt-1 block text-xs font-normal text-fb-muted">
                      IP/Hostname inklusive Protokoll und Port.
                    </span>
                  </label>
                </div>
              )
            }
          </SourcePicker>

          <div className="mt-4 space-y-4">
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
    </div>
  );
}
