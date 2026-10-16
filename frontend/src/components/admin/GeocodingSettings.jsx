import { useEffect, useState } from "react";

import {
  getAdminServiceSettings,
  getAdminSettings,
  testAdminService,
  updateAdminPhotonSettings,
  updateAdminSettings,
} from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";

const PUBLIC_PHOTON_URL = "https://photon.komoot.io";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft disabled:opacity-60";

const primaryButton =
  "rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60";

const secondaryButton =
  "rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:opacity-60";

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

export default function GeocodingSettings() {
  const { accessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [photon, setPhoton] = useState({
    provider: "public",
    baseUrl: "",
    timeoutMs: 10_000,
  });
  const [photonStatus, setPhotonStatus] = useState(null);
  const [photonBusy, setPhotonBusy] = useState(false);

  const [routing, setRouting] = useState({
    provider: "disabled",
    osrmUrl: "",
    valhallaUrl: "",
  });
  const [routingStatus, setRoutingStatus] = useState(null);
  const [routingBusy, setRoutingBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [services, settings] = await Promise.all([
          getAdminServiceSettings(accessToken),
          getAdminSettings(accessToken),
        ]);

        if (cancelled) return;

        const current = services.photon || {};
        const isPublic =
          (current.provider || "public") === "public" ||
          !current.baseUrl;

        setPhoton({
          provider: isPublic ? "public" : "custom",
          baseUrl: isPublic ? "" : current.baseUrl,
          timeoutMs: Number(current.timeoutMs || 10_000),
        });
        setRouting({
          provider: settings.mapMatching?.provider || "disabled",
          osrmUrl: settings.mapMatching?.osrmUrl || "",
          valhallaUrl: settings.mapMatching?.valhallaUrl || "",
        });
      } catch (error) {
        if (!cancelled) {
          setLoadError(errorText(error, "Die Geocoding-Einstellungen konnten nicht geladen werden."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  function photonPayload() {
    return {
      provider: photon.provider,
      baseUrl: photon.provider === "custom" ? photon.baseUrl.trim() : null,
      timeoutMs: Number(photon.timeoutMs),
    };
  }

  async function testPhoton() {
    setPhotonBusy(true);
    setPhotonStatus(null);

    try {
      const payload = photonPayload();
      const result = await testAdminService(accessToken, "photon", {
        ...payload,
        baseUrl: payload.baseUrl || PUBLIC_PHOTON_URL,
      });
      setPhotonStatus({
        ok: true,
        text: `${result.message} (${result.responseTimeMs} ms)`,
      });
    } catch (error) {
      setPhotonStatus({ ok: false, text: errorText(error, "Der Photon-Server ist nicht erreichbar.") });
    } finally {
      setPhotonBusy(false);
    }
  }

  async function savePhoton(event) {
    event.preventDefault();
    setPhotonBusy(true);
    setPhotonStatus(null);

    try {
      await updateAdminPhotonSettings(accessToken, photonPayload());
      setPhotonStatus({ ok: true, text: "Die Photon-Einstellungen wurden gespeichert." });
    } catch (error) {
      setPhotonStatus({ ok: false, text: errorText(error, "Die Photon-Einstellungen konnten nicht gespeichert werden.") });
    } finally {
      setPhotonBusy(false);
    }
  }

  async function testRouting(category) {
    setRoutingBusy(true);
    setRoutingStatus(null);

    try {
      const result = await testAdminService(accessToken, category, {
        osrmUrl: routing.osrmUrl.trim(),
        valhallaUrl: routing.valhallaUrl.trim(),
      });
      setRoutingStatus({
        ok: true,
        text: `${result.message} (${result.responseTimeMs} ms)`,
      });
    } catch (error) {
      setRoutingStatus({ ok: false, text: errorText(error, "Der Routing-Server ist nicht erreichbar.") });
    } finally {
      setRoutingBusy(false);
    }
  }

  async function saveRouting(event) {
    event.preventDefault();
    setRoutingBusy(true);
    setRoutingStatus(null);

    try {
      // Nur mapMatching senden, damit die übrigen Systemeinstellungen unberührt bleiben
      const result = await updateAdminSettings(accessToken, {
        mapMatching: {
          provider: routing.provider,
          osrmUrl: routing.osrmUrl.trim(),
          valhallaUrl: routing.valhallaUrl.trim(),
        },
      });

      if (result?.mapMatching) setRouting(result.mapMatching);
      setRoutingStatus({ ok: true, text: "Die Map-Matching-Einstellungen wurden gespeichert." });
    } catch (error) {
      setRoutingStatus({ ok: false, text: errorText(error, "Die Map-Matching-Einstellungen konnten nicht gespeichert werden.") });
    } finally {
      setRoutingBusy(false);
    }
  }

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

  return (
    <div className="space-y-8">
      {/* Photon: Adresssuche und Rückwärts-Geocoding */}
      <form
        onSubmit={savePhoton}
        className="rounded-xl border border-fb-border bg-fb-main p-[22px]"
      >
        <h2 className="text-lg font-bold">Adresssuche (Photon)</h2>
        <p className="mt-1 text-sm text-fb-muted">
          Photon wandelt Adressen in Koordinaten um und ermittelt die Start- und
          Zieladressen von Fahrten. Standard ist der öffentliche Server von
          komoot. Für mehr Datenschutz und ohne Nutzungsgrenzen kannst du einen
          eigenen Photon-Server eintragen.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Photon-Server
            <select
              value={photon.provider}
              onChange={(event) =>
                setPhoton((current) => ({ ...current, provider: event.target.value }))
              }
              className={fieldClass}
            >
              <option value="public">Öffentlicher Server (photon.komoot.io)</option>
              <option value="custom">Eigener Photon-Server</option>
            </select>
          </label>

          <label className="block text-sm font-medium">
            Zeitlimit in Millisekunden
            <input
              type="number"
              min="1000"
              max="120000"
              step="500"
              value={photon.timeoutMs}
              onChange={(event) =>
                setPhoton((current) => ({ ...current, timeoutMs: Number(event.target.value) }))
              }
              className={fieldClass}
            />
          </label>

          {photon.provider === "custom" && (
            <label className="block text-sm font-medium sm:col-span-2">
              Photon-Serveradresse
              <input
                type="url"
                required
                placeholder="http://192.168.1.12:2322"
                value={photon.baseUrl}
                onChange={(event) =>
                  setPhoton((current) => ({ ...current, baseUrl: event.target.value }))
                }
                className={fieldClass}
              />
              <span className="mt-1 block text-xs font-normal text-fb-muted">
                Basis-URL inklusive Protokoll und Port, ohne /api. Der Server
                muss nur vom Fahrtenbuch-Backend erreichbar sein, nicht vom Browser.
              </span>
            </label>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <StatusLine status={photonStatus} />
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={testPhoton} disabled={photonBusy} className={secondaryButton}>
              Verbindung testen
            </button>
            <button type="submit" disabled={photonBusy} className={primaryButton}>
              {photonBusy ? "Bitte warten …" : "Photon speichern"}
            </button>
          </div>
        </div>
      </form>

      {/* Valhalla/OSRM: Map-Matching der GPS-Spuren auf das Straßennetz */}
      <form
        onSubmit={saveRouting}
        className="rounded-xl border border-fb-border bg-fb-main p-[22px]"
      >
        <h2 className="text-lg font-bold">Map-Matching (Valhalla / OSRM)</h2>
        <p className="mt-1 text-sm text-fb-muted">
          Ein eigener Routing-Server legt aufgezeichnete GPS-Punkte auf das
          Straßennetz. Lücken in der Aufzeichnung werden entlang der Straße
          statt als Luftlinie geschlossen, dadurch stimmt die Distanz besser.
          Es gibt keinen öffentlichen Standardserver.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Routing-Server
            <select
              value={routing.provider}
              onChange={(event) =>
                setRouting((current) => ({ ...current, provider: event.target.value }))
              }
              className={fieldClass}
            >
              <option value="disabled">Kein Map-Matching</option>
              <option value="valhalla">Eigener Valhalla-Server</option>
              <option value="osrm">Eigener OSRM-Server</option>
            </select>
          </label>

          <div className="hidden sm:block" />

          {routing.provider === "valhalla" && (
            <label className="block text-sm font-medium sm:col-span-2">
              Valhalla-Serveradresse
              <input
                type="url"
                required
                placeholder="http://192.168.1.11:8002"
                value={routing.valhallaUrl}
                onChange={(event) =>
                  setRouting((current) => ({ ...current, valhallaUrl: event.target.value }))
                }
                className={fieldClass}
              />
              <span className="mt-1 block text-xs font-normal text-fb-muted">
                IP/Hostname inklusive Protokoll und Port. Der Standardport von
                Valhalla ist 8002.
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
                onChange={(event) =>
                  setRouting((current) => ({ ...current, osrmUrl: event.target.value }))
                }
                className={fieldClass}
              />
              <span className="mt-1 block text-xs font-normal text-fb-muted">
                IP/Hostname inklusive Protokoll und Port, z. B. http://192.168.1.10:5000
              </span>
            </label>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <StatusLine status={routingStatus} />
          <div className="flex flex-wrap justify-end gap-3">
            {routing.provider !== "disabled" && (
              <button
                type="button"
                onClick={() => testRouting(routing.provider)}
                disabled={routingBusy}
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
