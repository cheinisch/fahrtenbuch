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
import PageHeader from "../components/PageHeader.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

const fieldClass =
  "mt-1.5 block h-11 w-full rounded-lg border border-fb-border bg-fb-surface px-3 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

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

  // Sofortiges Freigeben bricht den Download in Firefox/Safari teils ab.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function localIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Schnellauswahl für übliche Abrechnungszeiträume (lokale Kalendertage).
function periodPresets(t, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3);
  const previousQuarterStart = new Date(year, (quarter - 1) * 3, 1);
  return [
    { id: "ytd", label: t("exportPage.presetYtd"), from: localIsoDate(new Date(year, 0, 1)), to: localIsoDate(now) },
    { id: "lastMonth", label: t("exportPage.presetLastMonth"), from: localIsoDate(new Date(year, month - 1, 1)), to: localIsoDate(new Date(year, month, 0)) },
    { id: "lastQuarter", label: t("exportPage.presetLastQuarter"), from: localIsoDate(previousQuarterStart), to: localIsoDate(new Date(previousQuarterStart.getFullYear(), previousQuarterStart.getMonth() + 3, 0)) },
    { id: "lastYear", label: String(year - 1), from: localIsoDate(new Date(year - 1, 0, 1)), to: localIsoDate(new Date(year - 1, 11, 31)) },
  ];
}

export default function ExportPage() {
  const { accessToken } = useAuth();
  const { t } = useI18n();

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
              : t("exportPage.configFailed"),
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
                  : t("exportPage.dataFailed"),
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
          : t("exportPage.failed"),
      );
    } finally {
      setDownloading("");
    }
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={t("nav.export")}
        title={t("exportPage.title")}
        subtitle={t("exportPage.subtitle")}
      />

      {error && (
        <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-6">
      {country && (
        <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3.5">
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-fb-accent-soft text-[15px] font-bold text-fb-accent-strong">{country.code}</span>
            <div>
              <div className="text-[13px] font-semibold text-fb-accent-strong">
                {t("exportPage.countryProfile", { code: country.code })}
              </div>

              <h2 className="mt-0.5 text-xl font-bold">
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
                {t("exportPage.distancesIn", { unit: country.distanceUnit })}
              </p>
            </div>
            </div>

            <Link
              to="/profilesettings"
              className="text-sm font-semibold text-fb-accent-strong hover:underline"
            >
              {t("exportPage.changeCountry")}
            </Link>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <h2 className="text-lg font-bold">
          {t("exportPage.filtersTitle")}
        </h2>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {t("exportPage.from")}
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
            {t("exportPage.to")}
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
            {t("exportPage.vehicle")}
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
                {t("exportPage.allVehicles")}
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
            {t("exportPage.tripType")}
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
                {t("exportPage.allTypes")}
              </option>
              <option value="business">
                {t("statistics.categories.businessKm")}
              </option>
              <option value="commute">
                {t("statistics.categories.commuteKm")}
              </option>
              <option value="private">
                {t("statistics.categories.privateKm")}
              </option>
              <option value="unclassified">
                {t("statistics.categories.unclassifiedKm")}
              </option>
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {periodPresets(t).map((preset) => {
            const active = filters.from === preset.from && filters.to === preset.to;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilters((current) => ({ ...current, from: preset.from, to: preset.to }))}
                className={`min-h-9 rounded-full border px-3 text-sm transition ${active ? "border-fb-accent bg-fb-accent-soft font-semibold text-fb-accent" : "border-fb-border hover:border-fb-accent"}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </section>

      {loading || !summary ? (
        <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
          {t("exportPage.calculating")}
        </div>
      ) : (
        <>
          <section className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            {summaryItems.map(
              (item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-fb-border bg-fb-main p-4"
                >
                  <div className="text-[13px] text-fb-muted">
                    {item.label}
                  </div>

                  <div className="mt-1 text-2xl font-bold">
                    {item.value}
                  </div>
                </div>
              ),
            )}
          </section>

          {warnings.length > 0 && (
            <div className="flex gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
              <ExclamationTriangleIcon className="size-6 shrink-0 text-amber-600" />

              <div>
                <div className="font-semibold">
                  {t("exportPage.checkCompleteness")}
                </div>

                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-fb-muted">
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
        </>
      )}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6">
          <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fb-accent-soft text-fb-accent">
                <DocumentChartBarIcon className="size-6" />
              </span>
              <div>
                <h2 className="text-lg font-bold">{t("exportPage.createTitle")}</h2>
                <p className="mt-1 text-sm text-fb-muted">
                  {t("exportPage.createHint")}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                disabled={Boolean(downloading) || loading}
                onClick={() => download("pdf")}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-60"
              >
                <ArrowDownTrayIcon className="size-5" />
                {downloading === "pdf" ? t("exportPage.pdfCreating") : t("exportPage.pdfFor", { country: country?.name || t("exportPage.homeCountry") })}
              </button>
              <button
                type="button"
                disabled={Boolean(downloading) || loading}
                onClick={() => download("csv")}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-fb-border px-4 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"
              >
                <ArrowDownTrayIcon className="size-5" />
                {downloading === "csv" ? t("exportPage.csvCreating") : t("exportPage.csv")}
              </button>
            </div>

            <p className="mt-4 text-xs text-fb-muted">
              {t("exportPage.disclaimer")}
            </p>
          </section>

          {country?.requirements?.length > 0 && (
            <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
              <h2 className="text-base font-bold">{t("exportPage.requirements")}</h2>
              <ul className="mt-3 space-y-2 text-sm text-fb-muted">
                {country.requirements.map((requirement) => (
                  <li key={requirement} className="flex gap-2">
                    <span className="text-fb-accent">•</span>
                    <span>{requirement}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
