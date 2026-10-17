import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  CircleStackIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  useState,
} from "react";

import {
  downloadSystemData,
  importSystemData,
  validateSystemDataImport,
} from "../../api/dataTransfer.js";
import {
  useAuth,
} from "../../auth/AuthProvider.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";

// Fester Bestätigungstext, bewusst unübersetzt.
const CONFIRM_PHRASE = "SYSTEM IMPORTIEREN";

function saveDownload({
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

function SummaryValue({
  label,
  value,
}) {
  return (
    <div className="rounded-lg border border-fb-border bg-fb-surface p-3">
      <div className="text-xs text-fb-muted">
        {label}
      </div>

      <div className="mt-1 text-xl font-bold">
        {Number(value || 0)}
      </div>
    </div>
  );
}

export default function AdminDataTransfer() {
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();

  const [file, setFile] =
    useState(null);

  const [
    restoreSystemSettings,
    setRestoreSystemSettings,
  ] = useState(false);

  const [
    confirmation,
    setConfirmation,
  ] = useState("");

  const [
    validationResult,
    setValidationResult,
  ] = useState(null);

  const [busy, setBusy] =
    useState("");

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  async function handleExport() {
    setBusy("export");
    setError("");
    setMessage("");

    try {
      const download =
        await downloadSystemData(
          accessToken,
        );

      saveDownload(download);

      setMessage(
        download.checksum
          ? t("adminDataTransfer.exportedChecksum", { checksum: download.checksum })
          : t("adminDataTransfer.exported"),
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : t("adminDataTransfer.exportFailed"),
      );
    } finally {
      setBusy("");
    }
  }

  function selectFile(
    selectedFile,
  ) {
    setFile(selectedFile || null);
    setValidationResult(null);
    setConfirmation("");
    setError("");
    setMessage("");
  }

  async function validateFile() {
    if (!file) {
      setError(
        t("adminDataTransfer.selectFile"),
      );
      return;
    }

    setBusy("validate");
    setError("");
    setMessage("");

    try {
      const result =
        await validateSystemDataImport(
          accessToken,
          file,
          {
            restoreSystemSettings,
          },
        );

      setValidationResult(
        result,
      );

      setMessage(
        t("adminDataTransfer.validated"),
      );
    } catch (validationError) {
      setValidationResult(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : t("adminDataTransfer.invalid"),
      );
    } finally {
      setBusy("");
    }
  }

  async function importFile() {
    if (
      !file ||
      confirmation !==
        CONFIRM_PHRASE
    ) {
      return;
    }

    setBusy("import");
    setError("");
    setMessage("");

    try {
      const result =
        await importSystemData(
          accessToken,
          file,
          {
            restoreSystemSettings,
          },
        );

      setValidationResult(
        result,
      );

      setMessage(
        t("adminDataTransfer.imported"),
      );

      setConfirmation("");
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : t("adminDataTransfer.importFailed"),
      );
    } finally {
      setBusy("");
    }
  }

  const result =
    validationResult?.result;

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fb-accent-soft text-fb-accent">
            <CircleStackIcon className="size-6" />
          </span>

          <div>
            <h2 className="text-lg font-bold">
              {t("adminDataTransfer.title")}
            </h2>

            <p className="mt-1 text-sm text-fb-muted">
              {t("adminDataTransfer.hint")}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-fb-border bg-fb-surface p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0 text-fb-danger" />

            <div className="text-sm">
              <div className="font-semibold">
                {t("adminDataTransfer.excludedTitle")}
              </div>

              <p className="mt-1 text-fb-muted">
                {t("adminDataTransfer.excludedHint")}
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={Boolean(busy)}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
        >
          <ArrowDownTrayIcon className="size-5" />
          {busy === "export"
            ? t("adminDataTransfer.exporting")
            : t("adminDataTransfer.download")}
        </button>
      </section>

      <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold">
          {t("adminDataTransfer.restoreTitle")}
        </h2>

        <p className="mt-2 text-sm text-fb-muted">
          {t("adminDataTransfer.restoreHint")}
        </p>

        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) =>
            selectFile(
              event.target.files?.[0],
            )
          }
          className="mt-5 block w-full text-sm text-fb-muted file:mr-4 file:rounded-lg file:border-0 file:bg-fb-surface file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-fb-text hover:file:bg-fb-accent-soft"
        />

        {file && (
          <div className="mt-3 text-xs text-fb-muted">
            {file.name}
            {" · "}
            {(
              file.size /
              1024 /
              1024
            ).toLocaleString(
              locale,
              {
                maximumFractionDigits: 2,
              },
            )}{" "}
            MB
          </div>
        )}

        <label className="mt-5 flex items-start gap-3 rounded-lg border border-fb-border bg-fb-surface p-4">
          <input
            type="checkbox"
            checked={
              restoreSystemSettings
            }
            onChange={(event) => {
              setRestoreSystemSettings(
                event.target.checked,
              );
              setValidationResult(null);
            }}
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />

          <span>
            <span className="block text-sm font-semibold">
              {t("adminDataTransfer.restoreSettings")}
            </span>

            <span className="mt-1 block text-xs text-fb-muted">
              {t("adminDataTransfer.restoreSettingsHint")}
            </span>
          </span>
        </label>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={validateFile}
            disabled={
              !file ||
              Boolean(busy)
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
          >
            <CheckCircleIcon className="size-5" />
            {busy === "validate"
              ? t("adminDataTransfer.validating")
              : t("adminDataTransfer.validate")}
          </button>
        </div>

        {result && (
          <div className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryValue
                label={t("adminDataTransfer.newUsers")}
                value={
                  result.users?.created
                }
              />

              <SummaryValue
                label={t("adminDataTransfer.updatedUsers")}
                value={
                  result.users?.updated
                }
              />

              <SummaryValue
                label={t("adminDataTransfer.vehicles")}
                value={result.vehicles}
              />

              <SummaryValue
                label={t("adminDataTransfer.trips")}
                value={result.trips}
              />

              <SummaryValue
                label={t("adminDataTransfer.trackPoints")}
                value={
                  result.trackPoints
                }
              />

              <SummaryValue
                label={t("adminDataTransfer.batches")}
                value={
                  result.trackPointBatches
                }
              />

              <SummaryValue
                label={t("adminDataTransfer.tags")}
                value={result.tags}
              />

              <SummaryValue
                label={t("adminDataTransfer.changeLog")}
                value={
                  result.tripChangeLog
                }
              />

              <SummaryValue
                label={t("adminDataTransfer.settings")}
                value={
                  result.appSettings
                }
              />
            </div>

            {result.warnings?.length >
              0 && (
              <div className="mt-4 rounded-lg border border-fb-accent bg-fb-accent-soft p-4">
                <div className="font-semibold">
                  {t("adminDataTransfer.warnings")}
                </div>

                <ul className="mt-2 space-y-1 text-sm text-fb-muted">
                  {result.warnings.map(
                    (warning) => (
                      <li key={warning}>
                        {warning}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}

            <div className="mt-5 rounded-lg border border-fb-danger p-4">
              <label className="block text-sm font-medium">
                {t("adminDataTransfer.confirmLabel", { phrase: CONFIRM_PHRASE })}
                <input
                  type="text"
                  value={confirmation}
                  onChange={(event) =>
                    setConfirmation(
                      event.target.value,
                    )
                  }
                  autoComplete="off"
                  className="mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm outline-none focus:border-fb-danger"
                />
              </label>

              <button
                type="button"
                onClick={importFile}
                disabled={
                  Boolean(busy) ||
                  confirmation !==
                    CONFIRM_PHRASE
                }
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-fb-danger px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <ArrowUpTrayIcon className="size-5" />
                {busy === "import"
                  ? t("adminDataTransfer.importing")
                  : t("adminDataTransfer.import")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
