import {
  ArrowDownTrayIcon,
  DocumentChartBarIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  useEffect,
  useState,
} from "react";
import {
  Link,
} from "react-router-dom";

import {
  getVehicles,
} from "../api/app.js";
import {
  downloadCountryExport,
  getCountryExportSummary,
  getExportCountryOptions,
} from "../api/countryExport.js";
import {
  useAuth,
} from "../auth/AuthProvider.jsx";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function saveBlob({
  blob,
  filename,
}) {
  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export default function ExportPage() {
  const { accessToken } = useAuth();

  const [vehicles, setVehicles] =
    useState([]);

  const [filters, setFilters] =
    useState({
      from: "",
      to: "",
      vehicleId: "",
      type: "",
    });

  const [country, setCountry] =
    useState(null);

  const [summary, setSummary] =
    useState(null);

  const [summaryItems, setSummaryItems] =
    useState([]);

  const [warnings, setWarnings] =
    useState([]);

  const [initialized, setInitialized] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [downloading, setDownloading] =
    useState("");

  const [error, setError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setLoading(true);
      setError("");

      try {
        const [
          vehicleResult,
          countryResult,
        ] = await Promise.all([
          getVehicles(accessToken),
          getExportCountryOptions(
            accessToken,
          ),
        ]);

        if (cancelled) {
          return;
        }

        setVehicles(vehicleResult);
        setCountry(
          countryResult.selectedCountry,
        );

        setFilters((current) => ({
          ...current,
          from:
            countryResult.defaultPeriod
              ?.from || "",
          to:
            countryResult.defaultPeriod
              ?.to || "",
        }));

        setInitialized(true);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Die Exportkonfiguration konnte nicht geladen werden.",
          );
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!initialized) {
      return undefined;
    }

    let cancelled = false;

    const timeout =
      window.setTimeout(
        async () => {
          setLoading(true);
          setError("");

          try {
            const result =
              await getCountryExportSummary(
                accessToken,
                filters,
              );

            if (!cancelled) {
              setCountry(
                result.country,
              );
              setSummary(
                result.summary,
              );
              setSummaryItems(
                result.summaryItems || [],
              );
              setWarnings(
                result.warnings || [],
              );
            }
          } catch (loadError) {
            if (!cancelled) {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Die Exportdaten konnten nicht geladen werden.",
              );
            }
          } finally {
            if (!cancelled) {
              setLoading(false);
            }
          }
        },
        200,
      );

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    accessToken,
    filters.from,
    filters.to,
    filters.vehicleId,
    filters.type,
    initialized,
  ]);

  async function download(format) {
    setDownloading(format);
    setError("");

    try {
      saveBlob(
        await downloadCountryExport(
          accessToken,
          format,
          filters,
        ),
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Der Export ist fehlgeschlagen.",
      );
    } finally {
      setDownloading("");
    }
  }

  return (
    <div className="space-y-7">
      <header>
        <p className="text-sm font-semibold text-fb-accent">
          Export
        </p>

        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Statistik und Fahrtenbuch
          exportieren
        </h1>

        <p className="mt-2 text-fb-muted">
          Der PDF-Aufbau wird automatisch
          anhand deines Heimatlands gewählt.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">
          {error}
        </div>
      )}

      {country && (
        <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-fb-accent">
                Länderprofil{" "}
                {country.code}
              </div>

              <h2 className="mt-1 text-xl font-bold">
                {country.reportTitle}
              </h2>

              <p className="mt-2 text-sm text-fb-muted">
                {country.name}
                {country.localName &&
                country.localName !==
                  country.name
                  ? ` · ${country.localName}`
                  : ""}
                {" · "}
                {country.taxYearLabel}
                {" · "}
                Entfernungen in{" "}
                {country.distanceUnit}
              </p>
            </div>

            <Link
              to="/profilesettings"
              className="text-sm font-semibold text-fb-accent hover:text-fb-accent-secondary"
            >
              Heimatland ändern
            </Link>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold">
          Zeitraum und Filter
        </h2>

        <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-medium">
            Von
            <input
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
              className={fieldClass}
            />
          </label>

          <label className="text-sm font-medium">
            Bis
            <input
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  to: event.target.value,
                }))
              }
              className={fieldClass}
            />
          </label>

          <label className="text-sm font-medium">
            Fahrzeug
            <select
              value={filters.vehicleId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  vehicleId:
                    event.target.value,
                }))
              }
              className={fieldClass}
            >
              <option value="">
                Alle Fahrzeuge
              </option>

              {vehicles.map(
                (vehicle) => (
                  <option
                    key={vehicle.id}
                    value={vehicle.id}
                  >
                    {vehicle.name}
                    {vehicle.licensePlate
                      ? ` (${vehicle.licensePlate})`
                      : ""}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="text-sm font-medium">
            Fahrtenart
            <select
              value={filters.type}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  type: event.target.value,
                }))
              }
              className={fieldClass}
            >
              <option value="">
                Alle Arten
              </option>
              <option value="business">
                Dienstlich
              </option>
              <option value="commute">
                Arbeitsweg
              </option>
              <option value="private">
                Privat
              </option>
              <option value="unclassified">
                Nicht zugeordnet
              </option>
            </select>
          </label>
        </div>
      </section>

      {loading || !summary ? (
        <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
          Statistik wird berechnet …
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {summaryItems.map(
              (item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-fb-border bg-fb-main p-5"
                >
                  <div className="text-sm text-fb-muted">
                    {item.label}
                  </div>

                  <div className="mt-2 text-2xl font-bold">
                    {item.value}
                  </div>
                </div>
              ),
            )}
          </section>

          {warnings.length > 0 && (
            <div className="flex gap-3 rounded-xl border border-fb-accent bg-fb-accent-soft p-4">
              <ExclamationTriangleIcon className="size-6 shrink-0 text-fb-danger" />

              <div>
                <div className="font-semibold">
                  Vollständigkeit prüfen
                </div>

                <ul className="mt-2 space-y-1 text-sm text-fb-muted">
                  {warnings.map(
                    (warning) => (
                      <li
                        key={warning.code}
                      >
                        {warning.message}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>
          )}

          {country?.requirements
            ?.length > 0 && (
            <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold">
                Angaben für dieses
                Länderprofil
              </h2>

              <ul className="mt-4 space-y-2 text-sm text-fb-muted">
                {country.requirements.map(
                  (requirement) => (
                    <li
                      key={requirement}
                      className="flex gap-2"
                    >
                      <span className="text-fb-accent">
                        •
                      </span>
                      <span>
                        {requirement}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-fb-accent-soft text-fb-accent">
                <DocumentChartBarIcon className="size-6" />
              </span>

              <div>
                <h2 className="text-lg font-bold">
                  Export erstellen
                </h2>

                <p className="mt-1 text-sm text-fb-muted">
                  Das PDF enthält das
                  ausgewählte Länderprofil,
                  eine Zusammenfassung,
                  Fahrten, Kilometerstände,
                  Änderungen und einen
                  Anforderungsanhang.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={Boolean(
                  downloading,
                )}
                onClick={() =>
                  download("pdf")
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-60"
              >
                <ArrowDownTrayIcon className="size-5" />
                {downloading === "pdf"
                  ? "PDF wird erstellt …"
                  : `PDF für ${country?.name || "das Heimatland"}`}
              </button>

              <button
                type="button"
                disabled={Boolean(
                  downloading,
                )}
                onClick={() =>
                  download("csv")
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"
              >
                <ArrowDownTrayIcon className="size-5" />
                {downloading === "csv"
                  ? "CSV wird erstellt …"
                  : "CSV exportieren"}
              </button>
            </div>

            <p className="mt-4 text-xs text-fb-muted">
              Das Länderprofil strukturiert den
              Bericht. Die Anerkennung hängt von
              der vollständigen und zeitnahen
              Erfassung sowie den im Einzelfall
              geltenden steuerlichen Regeln ab.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
