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
          ? `Der systemweite Export wurde erstellt. SHA-256: ${download.checksum}`
          : "Der systemweite Export wurde erstellt.",
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Der Systemexport ist fehlgeschlagen.",
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
        "Bitte wähle zuerst einen systemweiten JSON-Export aus.",
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
        "Die Datei wurde innerhalb einer zurückgerollten Datenbanktransaktion geprüft. Es wurden noch keine Daten übernommen.",
      );
    } catch (validationError) {
      setValidationResult(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Der Systemexport ist ungültig.",
      );
    } finally {
      setBusy("");
    }
  }

  async function importFile() {
    if (
      !file ||
      confirmation !==
        "SYSTEM IMPORTIEREN"
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
        "Die Systemdaten wurden zusammengeführt. Neu angelegte Benutzerkonten sind deaktiviert und benötigen ein neues Passwort.",
      );

      setConfirmation("");
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Der Systemimport ist fehlgeschlagen.",
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
              Systemweite Datensicherung
            </h2>

            <p className="mt-1 text-sm text-fb-muted">
              Exportiert Benutzerprofile,
              Benutzereinstellungen,
              Fahrzeuge, Fahrten, Tags,
              GPS-Punkte,
              Änderungsnachweise und
              optional die zentralen
              Systemeinstellungen.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-fb-border bg-fb-surface p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0 text-fb-danger" />

            <div className="text-sm">
              <div className="font-semibold">
                Sicherheitsdaten werden bewusst
                ausgeschlossen
              </div>

              <p className="mt-1 text-fb-muted">
                Passwort-Hashes, TOTP-Secrets,
                Passkeys, Refresh-Sitzungen,
                Reset-Tokens, Pairing-Tokens und
                Push-Tokens sind nicht Bestandteil
                des Exports.
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
            ? "Systemexport wird erstellt …"
            : "Alle Systemdaten exportieren"}
        </button>
      </section>

      <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold">
          Systemdaten importieren
        </h2>

        <p className="mt-2 text-sm text-fb-muted">
          Der Import arbeitet im
          Zusammenführen-Modus. Bestehende
          Benutzer werden über ID oder
          E-Mail-Adresse zugeordnet. Das
          Heimatland und andere Einstellungen
          können wiederhergestellt werden; die
          bestehende Heimatadresse vorhandener
          Benutzer wird nicht verändert.
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
              "de-DE",
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
              Zentrale Systemeinstellungen
              wiederherstellen
            </span>

            <span className="mt-1 block text-xs text-fb-muted">
              Überschreibt unter anderem
              Karten-, Tracking- und
              Pairing-Standardwerte aus
              `app_settings`.
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
              ? "Prüfung läuft …"
              : "Systemimport prüfen"}
          </button>
        </div>

        {result && (
          <div className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryValue
                label="Neue Benutzer"
                value={
                  result.users?.created
                }
              />

              <SummaryValue
                label="Aktualisierte Benutzer"
                value={
                  result.users?.updated
                }
              />

              <SummaryValue
                label="Fahrzeuge"
                value={result.vehicles}
              />

              <SummaryValue
                label="Fahrten"
                value={result.trips}
              />

              <SummaryValue
                label="GPS-Punkte"
                value={
                  result.trackPoints
                }
              />

              <SummaryValue
                label="Tags"
                value={result.tags}
              />

              <SummaryValue
                label="Änderungsnachweise"
                value={
                  result.tripChangeLog
                }
              />

              <SummaryValue
                label="Systemeinstellungen"
                value={
                  result.appSettings
                }
              />
            </div>

            {result.warnings?.length >
              0 && (
              <div className="mt-4 rounded-lg border border-fb-accent bg-fb-accent-soft p-4">
                <div className="font-semibold">
                  Importhinweise
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
                Zur Bestätigung exakt
                `SYSTEM IMPORTIEREN` eingeben
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
                    "SYSTEM IMPORTIEREN"
                }
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-fb-danger px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <ArrowUpTrayIcon className="size-5" />
                {busy === "import"
                  ? "Systemimport läuft …"
                  : "Geprüfte Systemdaten importieren"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
