import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  useRef,
  useState,
} from "react";

import {
  downloadOwnData,
  importOwnData,
  validateOwnDataImport,
} from "../api/dataTransfer.js";
import {
  useAuth,
} from "../auth/AuthProvider.jsx";

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

function ResultSummary({
  result,
}) {
  if (!result) {
    return null;
  }

  const values = [
    [
      "Einstellungen",
      result.settings,
    ],
    [
      "Fahrzeuge",
      result.vehicles,
    ],
    ["Tags", result.tags],
    ["Fahrten", result.trips],
    [
      "GPS-Punkte",
      result.trackPoints,
    ],
    [
      "Tag-Zuordnungen",
      result.tripTags,
    ],
    [
      "Änderungsnachweise",
      result.tripChangeLog,
    ],
  ];

  return (
    <div className="mt-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {values.map(
          ([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-fb-border bg-fb-surface p-3"
            >
              <div className="text-xs text-fb-muted">
                {label}
              </div>

              <div className="mt-1 text-lg font-bold">
                {Number(value || 0)}
              </div>
            </div>
          ),
        )}
      </div>

      {result.warnings?.length >
        0 && (
        <div className="mt-4 rounded-lg border border-fb-accent bg-fb-accent-soft p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0 text-fb-danger" />

            <div>
              <div className="text-sm font-semibold">
                Hinweise
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
          </div>
        </div>
      )}
    </div>
  );
}

export default function UserDataTransfer() {
  const { accessToken } = useAuth();

  const fileInputRef =
    useRef(null);

  const [file, setFile] =
    useState(null);

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
        await downloadOwnData(
          accessToken,
        );

      saveDownload(download);

      setMessage(
        download.checksum
          ? `Der persönliche Datenexport wurde erstellt. SHA-256: ${download.checksum}`
          : "Der persönliche Datenexport wurde erstellt.",
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Der Datenexport ist fehlgeschlagen.",
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
    setError("");
    setMessage("");
  }

  async function validateFile() {
    if (!file) {
      setError(
        "Bitte wähle zuerst eine JSON-Datei aus.",
      );
      return;
    }

    setBusy("validate");
    setError("");
    setMessage("");

    try {
      const result =
        await validateOwnDataImport(
          accessToken,
          file,
        );

      setValidationResult(
        result,
      );

      setMessage(
        "Die Datei wurde vollständig geprüft. Es wurden noch keine Daten gespeichert.",
      );
    } catch (validationError) {
      setValidationResult(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Die Importdatei ist ungültig.",
      );
    } finally {
      setBusy("");
    }
  }

  async function importFile() {
    if (!file) {
      return;
    }

    setBusy("import");
    setError("");
    setMessage("");

    try {
      const result =
        await importOwnData(
          accessToken,
          file,
        );

      setValidationResult(
        result,
      );

      setMessage(
        "Deine Daten wurden zusammengeführt. Bereits vorhandene Datensätze mit derselben ID wurden aktualisiert.",
      );
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Der Datenimport ist fehlgeschlagen.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fb-accent-soft text-fb-accent">
          <DocumentArrowDownIcon className="size-6" />
        </span>

        <div>
          <h2 className="text-lg font-bold">
            Persönliche Datensicherung
          </h2>

          <p className="mt-1 text-sm text-fb-muted">
            Sichere Profil,
            Einstellungen, Fahrzeuge, Tags,
            Fahrten, GPS-Punkte und
            Änderungsnachweise als portable
            JSON-Datei.
          </p>
        </div>
      </div>

      {message && (
        <div className="mt-5 rounded-lg border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent">
          {message}
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-lg border border-fb-danger px-4 py-3 text-sm text-fb-danger">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-fb-border p-4">
          <h3 className="font-semibold">
            Eigene Daten exportieren
          </h3>

          <p className="mt-2 text-sm text-fb-muted">
            Sicherheitsdaten wie
            Passwort-Hashes, TOTP-Secrets,
            Passkeys und aktive Sitzungen
            werden nicht exportiert.
          </p>

          <button
            type="button"
            onClick={handleExport}
            disabled={Boolean(busy)}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
          >
            <ArrowDownTrayIcon className="size-5" />
            {busy === "export"
              ? "Export wird erstellt …"
              : "Meine Daten exportieren"}
          </button>
        </div>

        <div className="rounded-xl border border-fb-border p-4">
          <h3 className="font-semibold">
            Eigene Daten importieren
          </h3>

          <p className="mt-2 text-sm text-fb-muted">
            Der Import arbeitet im
            Zusammenführen-Modus. Deine
            E-Mail-Adresse, dein
            Anmeldename, deine Rolle und
            deine Sicherheitsverfahren
            werden dabei nicht verändert.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) =>
              selectFile(
                event.target.files?.[0],
              )
            }
            className="mt-4 block w-full text-sm text-fb-muted file:mr-4 file:rounded-lg file:border-0 file:bg-fb-surface file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-fb-text hover:file:bg-fb-accent-soft"
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
                : "Import prüfen"}
            </button>

            <button
              type="button"
              onClick={importFile}
              disabled={
                !file ||
                !validationResult ||
                Boolean(busy)
              }
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-50"
            >
              <ArrowUpTrayIcon className="size-5" />
              {busy === "import"
                ? "Import läuft …"
                : "Geprüfte Daten importieren"}
            </button>
          </div>
        </div>
      </div>

      <ResultSummary
        result={
          validationResult?.result
        }
      />
    </section>
  );
}
