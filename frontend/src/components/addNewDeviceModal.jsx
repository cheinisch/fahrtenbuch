import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  cancelPairing,
  createPairingOptions,
  getPairingStatus,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

function parsePayload(pairing) {
  if (pairing?.payloadObject) {
    return pairing.payloadObject;
  }

  if (!pairing?.payload) {
    return null;
  }

  try {
    return JSON.parse(pairing.payload);
  } catch {
    return null;
  }
}

function formatRemainingTime(seconds) {
  const safeSeconds = Math.max(
    0,
    Math.floor(Number(seconds) || 0),
  );

  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(
    safeSeconds % 60,
  ).padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function formatExpiration(value) {
  if (!value) {
    return "–";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export default function AddNewDeviceModal({
  open,
  onClose,
  onPaired,
}) {
  const { accessToken } = useAuth();

  const [pairing, setPairing] = useState(null);
  const [secondsLeft, setSecondsLeft] =
    useState(0);
  const [pairingStatus, setPairingStatus] =
    useState("pending");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const pairingRef = useRef(null);
  const requestVersionRef = useRef(0);
  const refreshingRef = useRef(false);
  const completedRef = useRef(false);

  const payloadObject = useMemo(
    () => parsePayload(pairing),
    [pairing],
  );

  const cancelCurrentPairing = useCallback(
    async (candidate = pairingRef.current) => {
      if (
        !candidate?.pairId ||
        candidate.status === "completed"
      ) {
        return;
      }

      try {
        await cancelPairing(
          accessToken,
          candidate.pairId,
        );
      } catch {
        // Bereits abgelaufene, verwendete oder entfernte
        // Pairings müssen nicht erneut abgebrochen werden.
      }
    },
    [accessToken],
  );

  const generatePairing = useCallback(
    async ({
      cancelPrevious = false,
    } = {}) => {
      if (
        !open ||
        !accessToken ||
        refreshingRef.current
      ) {
        return;
      }

      refreshingRef.current = true;
      setLoading(true);
      setError("");
      setCopied(false);

      const requestVersion =
        ++requestVersionRef.current;

      try {
        if (cancelPrevious) {
          await cancelCurrentPairing();
        }

        const result =
          await createPairingOptions(accessToken);

        if (
          requestVersion !==
            requestVersionRef.current ||
          !open
        ) {
          await cancelCurrentPairing(result);
          return;
        }

        const nextPairing = {
          ...result,
          status: "pending",
        };

        pairingRef.current = nextPairing;
        completedRef.current = false;

        setPairing(nextPairing);
        setPairingStatus("pending");

        const remaining = Math.max(
          0,
          Math.ceil(
            (new Date(
              result.expiresAt,
            ).getTime() -
              Date.now()) /
              1000,
          ),
        );

        setSecondsLeft(remaining);
      } catch (generationError) {
        setError(
          generationError instanceof Error
            ? generationError.message
            : "Der QR-Code konnte nicht erzeugt werden.",
        );
      } finally {
        if (
          requestVersion ===
          requestVersionRef.current
        ) {
          setLoading(false);
        }

        refreshingRef.current = false;
      }
    },
    [
      accessToken,
      cancelCurrentPairing,
      open,
    ],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setPairing(null);
    pairingRef.current = null;
    setPairingStatus("pending");
    setSecondsLeft(0);
    setError("");
    setCopied(false);
    completedRef.current = false;

    generatePairing();

    return () => {
      requestVersionRef.current += 1;

      const currentPairing =
        pairingRef.current;

      pairingRef.current = null;

      if (
        currentPairing &&
        !completedRef.current
      ) {
        cancelCurrentPairing(
          currentPairing,
        );
      }
    };
  }, [
    cancelCurrentPairing,
    generatePairing,
    open,
  ]);

  useEffect(() => {
    if (
      !open ||
      !pairing?.expiresAt ||
      pairingStatus !== "pending"
    ) {
      return undefined;
    }

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil(
          (new Date(
            pairing.expiresAt,
          ).getTime() -
            Date.now()) /
            1000,
        ),
      );

      setSecondsLeft(remaining);

      if (
        remaining === 0 &&
        !refreshingRef.current
      ) {
        setPairingStatus("expired");

        generatePairing({
          cancelPrevious: false,
        });
      }
    };

    updateCountdown();

    const interval = window.setInterval(
      updateCountdown,
      250,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [
    generatePairing,
    open,
    pairing?.expiresAt,
    pairingStatus,
  ]);

  useEffect(() => {
    if (
      !open ||
      !pairing?.pairId ||
      pairingStatus !== "pending"
    ) {
      return undefined;
    }

    let cancelled = false;

    const checkStatus = async () => {
      try {
        const result = await getPairingStatus(
          accessToken,
          pairing.pairId,
        );

        if (cancelled) {
          return;
        }

        setPairingStatus(result.status);

        if (result.status === "completed") {
          completedRef.current = true;

          pairingRef.current = {
            ...pairingRef.current,
            status: "completed",
          };

          if (onPaired) {
            await onPaired();
          }

          window.setTimeout(() => {
            if (!cancelled) {
              onClose();
            }
          }, 900);
        }

        if (
          result.status === "expired" &&
          !refreshingRef.current
        ) {
          generatePairing({
            cancelPrevious: false,
          });
        }
      } catch (statusError) {
        if (!cancelled) {
          setError(
            statusError instanceof Error
              ? statusError.message
              : "Der Pairing-Status konnte nicht geprüft werden.",
          );
        }
      }
    };

    checkStatus();

    const interval = window.setInterval(
      checkStatus,
      2_000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    accessToken,
    generatePairing,
    onClose,
    onPaired,
    open,
    pairing?.pairId,
    pairingStatus,
  ]);

  async function handleCopyPayload() {
    if (!pairing?.payload) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        pairing.payload,
      );

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1_500);
    } catch {
      setError(
        "Der QR-Inhalt konnte nicht in die Zwischenablage kopiert werden.",
      );
    }
  }

  async function handleClose() {
    requestVersionRef.current += 1;

    if (!completedRef.current) {
      await cancelCurrentPairing();
    }

    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      className="relative z-[70]"
    >
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 data-closed:opacity-0"
      />

      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel
            transition
            className="w-full max-w-3xl transform overflow-hidden rounded-2xl border border-fb-border bg-fb-main shadow-2xl transition duration-200 data-closed:scale-95 data-closed:opacity-0"
          >
            <header className="flex items-start justify-between gap-4 border-b border-fb-border px-5 py-4 sm:px-6">
              <div>
                <DialogTitle className="text-xl font-bold text-fb-text">
                  Neues Gerät hinzufügen
                </DialogTitle>

                <p className="mt-1 text-sm text-fb-muted">
                  Öffne die Fahrtenbuch-App und
                  scanne den QR-Code.
                </p>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg p-2 text-fb-muted transition hover:bg-fb-surface hover:text-fb-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent"
              >
                <span className="sr-only">
                  Dialog schließen
                </span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[300px_minmax(0,1fr)]">
              <div className="flex flex-col items-center">
                <div className="flex size-[300px] max-w-full items-center justify-center rounded-2xl border border-fb-border bg-white p-4">
                  {loading && !pairing ? (
                    <ArrowPathIcon className="size-10 animate-spin text-fb-accent" />
                  ) : pairing?.qrCodeDataUrl ? (
                    <img
                      src={pairing.qrCodeDataUrl}
                      alt="QR-Code zum Verbinden der Fahrtenbuch-App"
                      className="size-full object-contain"
                    />
                  ) : (
                    <div className="px-6 text-center text-sm text-fb-muted">
                      QR-Code konnte nicht geladen
                      werden.
                    </div>
                  )}
                </div>

                <div className="mt-4 text-center">
                  {pairingStatus === "completed" ? (
                    <div className="inline-flex items-center gap-2 rounded-full bg-fb-accent-soft px-3 py-1.5 text-sm font-semibold text-fb-accent">
                      <CheckCircleIcon className="size-5" />
                      Gerät verbunden
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-fb-text">
                        Gültig für noch{" "}
                        <span className="font-mono text-fb-accent">
                          {formatRemainingTime(
                            secondsLeft,
                          )}
                        </span>
                      </div>

                      <div className="mt-1 text-xs text-fb-muted">
                        Der QR-Code wird nach Ablauf
                        automatisch erneuert.
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                {error && (
                  <div className="mb-4 rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">
                    {error}
                  </div>
                )}

                <div className="rounded-xl border border-fb-border bg-fb-surface p-4">
                  <h3 className="text-sm font-bold text-fb-text">
                    Verbindungsdaten
                  </h3>

                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-fb-muted">
                        Server
                      </dt>
                      <dd className="mt-1 break-all text-fb-text">
                        {payloadObject?.server || "–"}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-fb-muted">
                        Benutzer
                      </dt>
                      <dd className="mt-1 text-fb-text">
                        {payloadObject?.username ||
                          "–"}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-fb-muted">
                        E-Mail-Adresse
                      </dt>
                      <dd className="mt-1 break-all text-fb-text">
                        {payloadObject?.email || "–"}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-fb-muted">
                        Ablaufzeit
                      </dt>
                      <dd className="mt-1 text-fb-text">
                        {formatExpiration(
                          pairing?.expiresAt,
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-4 rounded-xl border border-fb-border p-4">
                  <p className="text-sm text-fb-muted">
                    Der QR-Code enthält ein
                    einmalig verwendbares Token. Teile
                    den Code nur mit einem Gerät, das
                    Zugriff auf dein Fahrtenbuch
                    erhalten soll.
                  </p>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleCopyPayload}
                    disabled={!pairing?.payload}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ClipboardDocumentIcon className="size-5" />
                    {copied
                      ? "Kopiert"
                      : "QR-Inhalt kopieren"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      generatePairing({
                        cancelPrevious: true,
                      })
                    }
                    disabled={
                      loading ||
                      pairingStatus === "completed"
                    }
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowPathIcon
                      className={[
                        "size-5",
                        loading
                          ? "animate-spin"
                          : "",
                      ].join(" ")}
                    />
                    QR-Code erneuern
                  </button>
                </div>
              </div>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
