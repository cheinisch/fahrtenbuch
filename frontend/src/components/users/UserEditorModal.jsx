import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  ShieldCheckIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  useEffect,
  useState,
} from "react";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60";

const labelClass =
  "block text-sm font-medium text-fb-text";

function createInitialState(user) {
  return {
    email: user?.email || "",
    loginName:
      user?.loginName ||
      user?.username ||
      "",
    displayName:
      user?.displayName || "",
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    role: user?.role || "user",
    status: user?.status || "active",
    locale: user?.locale || "de",
    timezone:
      user?.timezone || "Europe/Berlin",
    themeMode:
      user?.themeMode || "system",
    forcePasswordChange:
      user?.forcePasswordChange ?? true,
    totpRequired:
      user?.totpRequired ?? false,
    passkeyEnabled:
      user?.passkeyEnabled ?? true,
    password: "",
    passwordConfirmation: "",
  };
}

function formatDate(value) {
  if (!value) {
    return "Noch nie";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function SecurityStatus({ active, children }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold",
        active
          ? "bg-fb-accent-soft text-fb-accent"
          : "border border-fb-border text-fb-muted",
      ].join(" ")}
    >
      <span
        className={[
          "size-1.5 rounded-full",
          active
            ? "bg-fb-accent"
            : "bg-fb-muted",
        ].join(" ")}
      />
      {children}
    </span>
  );
}

export default function UserEditorModal({
  open,
  user,
  currentUserId,
  saving,
  securityAction,
  onClose,
  onSubmit,
  onDisableTotp,
  onDeletePasskey,
  onDeleteAllPasskeys,
  onLogoutSessions,
}) {
  const editing = Boolean(user?.id);
  const editingOwnAccount =
    editing && user.id === currentUserId;

  const [form, setForm] = useState(
    createInitialState(user),
  );
  const [showPassword, setShowPassword] =
    useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(createInitialState(user));
      setShowPassword(false);
      setError("");
    }
  }, [open, user]);

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function runSecurityAction(action) {
    setError("");

    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Die Sicherheitsänderung konnte nicht ausgeführt werden.",
      );
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.email.trim()) {
      setError(
        "Bitte gib eine E-Mail-Adresse ein.",
      );
      return;
    }

    if (
      form.loginName.trim() &&
      form.loginName.trim().length < 3
    ) {
      setError(
        "Der Anmeldename muss mindestens drei Zeichen lang sein.",
      );
      return;
    }

    if (!form.displayName.trim()) {
      setError(
        "Bitte gib einen Anzeigenamen ein.",
      );
      return;
    }

    if (!editing && form.password.length < 8) {
      setError(
        "Das Startpasswort muss mindestens acht Zeichen lang sein.",
      );
      return;
    }

    if (
      editing &&
      form.password &&
      form.password.length < 8
    ) {
      setError(
        "Das neue Passwort muss mindestens acht Zeichen lang sein.",
      );
      return;
    }

    if (
      form.password !==
      form.passwordConfirmation
    ) {
      setError(
        "Die eingegebenen Passwörter stimmen nicht überein.",
      );
      return;
    }

    const payload = {
      email: form.email.trim(),
      loginName:
        form.loginName.trim() || null,
      displayName: form.displayName.trim(),
      firstName:
        form.firstName.trim() || null,
      lastName:
        form.lastName.trim() || null,
      role: form.role,
      status: form.status,
      locale: form.locale,
      timezone: form.timezone.trim(),
      themeMode: form.themeMode,
      forcePasswordChange:
        form.forcePasswordChange,
      totpRequired: form.totpRequired,
      passkeyEnabled: form.passkeyEnabled,
    };

    if (form.password) {
      payload.password = form.password;
    }

    try {
      await onSubmit(payload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Der Benutzer konnte nicht gespeichert werden.",
      );
    }
  }

  const busy = saving || Boolean(securityAction);

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
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
            className="w-full max-w-4xl transform overflow-hidden rounded-2xl border border-fb-border bg-fb-main shadow-2xl transition duration-200 data-closed:scale-95 data-closed:opacity-0"
          >
            <header className="flex items-start justify-between gap-4 border-b border-fb-border px-5 py-4 sm:px-6">
              <div>
                <DialogTitle className="text-xl font-bold text-fb-text">
                  {editing
                    ? "Benutzer bearbeiten"
                    : "Benutzer anlegen"}
                </DialogTitle>

                <p className="mt-1 text-sm text-fb-muted">
                  Alle Kontodaten außer dem Heimatort
                  werden hier verwaltet.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg p-2 text-fb-muted transition hover:bg-fb-surface hover:text-fb-text disabled:opacity-50"
              >
                <span className="sr-only">
                  Dialog schließen
                </span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <form onSubmit={handleSubmit}>
              <div className="space-y-7 p-5 sm:p-6">
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger"
                  >
                    {error}
                  </div>
                )}

                <section>
                  <h3 className="text-sm font-bold text-fb-text">
                    Person und Konto
                  </h3>

                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <label className={labelClass}>
                      Vorname
                      <input
                        type="text"
                        value={form.firstName}
                        onChange={(event) =>
                          updateField(
                            "firstName",
                            event.target.value,
                          )
                        }
                        maxLength={80}
                        className={fieldClass}
                      />
                    </label>

                    <label className={labelClass}>
                      Nachname
                      <input
                        type="text"
                        value={form.lastName}
                        onChange={(event) =>
                          updateField(
                            "lastName",
                            event.target.value,
                          )
                        }
                        maxLength={80}
                        className={fieldClass}
                      />
                    </label>

                    <label className={labelClass}>
                      Anzeigename
                      <input
                        type="text"
                        value={form.displayName}
                        onChange={(event) =>
                          updateField(
                            "displayName",
                            event.target.value,
                          )
                        }
                        required
                        maxLength={120}
                        className={fieldClass}
                      />
                    </label>

                    <label className={labelClass}>
                      Anmeldename
                      <input
                        type="text"
                        value={form.loginName}
                        onChange={(event) =>
                          updateField(
                            "loginName",
                            event.target.value,
                          )
                        }
                        minLength={3}
                        maxLength={64}
                        className={fieldClass}
                      />
                    </label>

                    <label className={`${labelClass} sm:col-span-2`}>
                      E-Mail-Adresse
                      <input
                        type="email"
                        value={form.email}
                        onChange={(event) =>
                          updateField(
                            "email",
                            event.target.value,
                          )
                        }
                        required
                        className={fieldClass}
                      />
                    </label>

                    <label className={labelClass}>
                      Rolle
                      <select
                        value={form.role}
                        onChange={(event) =>
                          updateField(
                            "role",
                            event.target.value,
                          )
                        }
                        disabled={editingOwnAccount}
                        className={fieldClass}
                      >
                        <option value="user">
                          Benutzer
                        </option>
                        <option value="admin">
                          Administrator
                        </option>
                      </select>

                      {editingOwnAccount && (
                        <span className="mt-1 block text-xs text-fb-muted">
                          Die eigene Administratorrolle
                          kann nicht entfernt werden.
                        </span>
                      )}
                    </label>

                    <label className={labelClass}>
                      Status
                      <select
                        value={form.status}
                        onChange={(event) =>
                          updateField(
                            "status",
                            event.target.value,
                          )
                        }
                        disabled={editingOwnAccount}
                        className={fieldClass}
                      >
                        <option value="active">
                          Aktiv
                        </option>
                        <option value="disabled">
                          Deaktiviert
                        </option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="border-t border-fb-border pt-6">
                  <h3 className="text-sm font-bold text-fb-text">
                    Sprache und Darstellung
                  </h3>

                  <div className="mt-4 grid gap-5 sm:grid-cols-3">
                    <label className={labelClass}>
                      Sprache
                      <select
                        value={form.locale}
                        onChange={(event) =>
                          updateField(
                            "locale",
                            event.target.value,
                          )
                        }
                        className={fieldClass}
                      >
                        <option value="de">
                          Deutsch
                        </option>
                        <option value="en">
                          English
                        </option>
                      </select>
                    </label>

                    <label className={labelClass}>
                      Zeitzone
                      <input
                        type="text"
                        value={form.timezone}
                        onChange={(event) =>
                          updateField(
                            "timezone",
                            event.target.value,
                          )
                        }
                        maxLength={64}
                        className={fieldClass}
                      />
                    </label>

                    <label className={labelClass}>
                      Darstellung
                      <select
                        value={form.themeMode}
                        onChange={(event) =>
                          updateField(
                            "themeMode",
                            event.target.value,
                          )
                        }
                        className={fieldClass}
                      >
                        <option value="system">
                          Systemeinstellung
                        </option>
                        <option value="light">
                          Hell
                        </option>
                        <option value="dark">
                          Dunkel
                        </option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="border-t border-fb-border pt-6">
                  <h3 className="text-sm font-bold text-fb-text">
                    Passwort
                  </h3>

                  <p className="mt-1 text-sm text-fb-muted">
                    {editing
                      ? "Leer lassen, um das bisherige Passwort beizubehalten. Bei einer Änderung werden andere Sitzungen abgemeldet."
                      : "Das Startpasswort wird nur als sicherer Hash gespeichert."}
                  </p>

                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <label className={labelClass}>
                      {editing
                        ? "Neues Passwort"
                        : "Startpasswort"}

                      <div className="relative">
                        <input
                          type={
                            showPassword
                              ? "text"
                              : "password"
                          }
                          value={form.password}
                          onChange={(event) =>
                            updateField(
                              "password",
                              event.target.value,
                            )
                          }
                          required={!editing}
                          minLength={8}
                          autoComplete="new-password"
                          className={`${fieldClass} pr-11`}
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowPassword(
                              (current) => !current,
                            )
                          }
                          className="absolute inset-y-0 right-0 mt-2 flex w-11 items-center justify-center text-fb-muted hover:text-fb-text"
                        >
                          {showPassword ? (
                            <EyeSlashIcon className="size-5" />
                          ) : (
                            <EyeIcon className="size-5" />
                          )}
                        </button>
                      </div>
                    </label>

                    <label className={labelClass}>
                      Passwort bestätigen
                      <input
                        type={
                          showPassword
                            ? "text"
                            : "password"
                        }
                        value={
                          form.passwordConfirmation
                        }
                        onChange={(event) =>
                          updateField(
                            "passwordConfirmation",
                            event.target.value,
                          )
                        }
                        required={!editing}
                        minLength={
                          form.password ? 8 : undefined
                        }
                        autoComplete="new-password"
                        className={fieldClass}
                      />
                    </label>
                  </div>

                  <label className="mt-5 flex items-start gap-3 rounded-lg border border-fb-border bg-fb-surface p-4">
                    <input
                      type="checkbox"
                      checked={
                        form.forcePasswordChange
                      }
                      onChange={(event) =>
                        updateField(
                          "forcePasswordChange",
                          event.target.checked,
                        )
                      }
                      className="mt-0.5 size-4 accent-[var(--color-accent)]"
                    />

                    <span>
                      <span className="block text-sm font-semibold text-fb-text">
                        Passwortwechsel beim nächsten
                        Login erzwingen
                      </span>
                      <span className="mt-1 block text-xs text-fb-muted">
                        Sinnvoll bei Start- oder
                        administrativ gesetzten Passwörtern.
                      </span>
                    </span>
                  </label>
                </section>

                <section className="border-t border-fb-border pt-6">
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="size-5 text-fb-accent" />
                    <h3 className="text-sm font-bold text-fb-text">
                      Zwei-Faktor-Authentifizierung
                    </h3>
                  </div>

                  <div className="mt-4 rounded-xl border border-fb-border bg-fb-surface p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-fb-text">
                            TOTP
                          </span>
                          <SecurityStatus
                            active={Boolean(
                              user?.totpEnabled,
                            )}
                          >
                            {user?.totpEnabled
                              ? "Aktiv"
                              : "Nicht eingerichtet"}
                          </SecurityStatus>
                        </div>

                        <p className="mt-2 max-w-2xl text-sm text-fb-muted">
                          Der Administrator kann TOTP
                          verlangen oder eine bestehende
                          Einrichtung entfernen. Das Secret
                          wird aus Sicherheitsgründen vom
                          Benutzer selbst eingerichtet und
                          bestätigt.
                        </p>
                      </div>

                      {editing && user?.totpEnabled && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runSecurityAction(
                              onDisableTotp,
                            )
                          }
                          className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-danger transition hover:border-fb-danger disabled:opacity-50"
                        >
                          {securityAction === "totp"
                            ? "Deaktivieren …"
                            : "TOTP deaktivieren"}
                        </button>
                      )}
                    </div>

                    <label className="mt-4 flex items-start gap-3 border-t border-fb-border pt-4">
                      <input
                        type="checkbox"
                        checked={form.totpRequired}
                        onChange={(event) =>
                          updateField(
                            "totpRequired",
                            event.target.checked,
                          )
                        }
                        className="mt-0.5 size-4 accent-[var(--color-accent)]"
                      />

                      <span>
                        <span className="block text-sm font-semibold text-fb-text">
                          TOTP-Einrichtung verlangen
                        </span>
                        <span className="mt-1 block text-xs text-fb-muted">
                          Der Benutzer soll TOTP in seinen
                          Profileinstellungen einrichten.
                        </span>
                      </span>
                    </label>
                  </div>
                </section>

                <section className="border-t border-fb-border pt-6">
                  <div className="flex items-center gap-2">
                    <KeyIcon className="size-5 text-fb-accent" />
                    <h3 className="text-sm font-bold text-fb-text">
                      Passkeys
                    </h3>
                  </div>

                  <div className="mt-4 rounded-xl border border-fb-border bg-fb-surface p-4">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={form.passkeyEnabled}
                        onChange={(event) =>
                          updateField(
                            "passkeyEnabled",
                            event.target.checked,
                          )
                        }
                        className="mt-0.5 size-4 accent-[var(--color-accent)]"
                      />

                      <span>
                        <span className="block text-sm font-semibold text-fb-text">
                          Passkey-Anmeldung und
                          Registrierung erlauben
                        </span>
                        <span className="mt-1 block text-xs text-fb-muted">
                          Beim Deaktivieren bleiben vorhandene
                          Passkeys gespeichert, können aber
                          nicht zur Anmeldung verwendet werden.
                        </span>
                      </span>
                    </label>

                    {editing && (
                      <div className="mt-4 border-t border-fb-border pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-fb-text">
                            Registrierte Passkeys: {" "}
                            {user?.passkeyCount || 0}
                          </div>

                          {Number(user?.passkeyCount || 0) > 0 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runSecurityAction(
                                  onDeleteAllPasskeys,
                                )
                              }
                              className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-danger transition hover:border-fb-danger disabled:opacity-50"
                            >
                              {securityAction === "all-passkeys"
                                ? "Löschen …"
                                : "Alle Passkeys löschen"}
                            </button>
                          )}
                        </div>

                        {user?.passkeys?.length > 0 ? (
                          <div className="mt-3 divide-y divide-fb-border overflow-hidden rounded-lg border border-fb-border bg-fb-main">
                            {user.passkeys.map((passkey) => (
                              <div
                                key={passkey.id}
                                className="flex items-center justify-between gap-3 px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-fb-text">
                                    {passkey.name || "Passkey"}
                                  </div>
                                  <div className="mt-1 text-xs text-fb-muted">
                                    Erstellt: {formatDate(passkey.createdAt)}
                                    {passkey.lastUsedAt
                                      ? ` · Zuletzt verwendet: ${formatDate(passkey.lastUsedAt)}`
                                      : ""}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    runSecurityAction(
                                      () =>
                                        onDeletePasskey(
                                          passkey.id,
                                        ),
                                    )
                                  }
                                  className="rounded-lg border border-fb-border p-2 text-fb-muted transition hover:border-fb-danger hover:text-fb-danger disabled:opacity-50"
                                >
                                  <span className="sr-only">
                                    Passkey löschen
                                  </span>
                                  <TrashIcon className="size-5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-fb-muted">
                            Es ist noch kein Passkey
                            registriert.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                {editing && (
                  <section className="border-t border-fb-border pt-6">
                    <h3 className="text-sm font-bold text-fb-text">
                      Sitzungen und Kontoinformationen
                    </h3>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
                        <div className="text-xs font-medium uppercase tracking-wide text-fb-muted">
                          Erstellt
                        </div>
                        <div className="mt-1 text-sm text-fb-text">
                          {formatDate(user?.createdAt)}
                        </div>
                      </div>

                      <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
                        <div className="text-xs font-medium uppercase tracking-wide text-fb-muted">
                          Letzter Login
                        </div>
                        <div className="mt-1 text-sm text-fb-text">
                          {formatDate(user?.lastLoginAt)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-fb-border bg-fb-surface p-4">
                      <div>
                        <div className="text-sm font-semibold text-fb-text">
                          Aktive Geräte: {" "}
                          {user?.activeDeviceCount || 0}
                        </div>
                        <div className="mt-1 text-xs text-fb-muted">
                          Alle Refresh-Sitzungen des Kontos
                          werden widerrufen. Beim eigenen Konto
                          bleibt die aktuelle Sitzung bestehen.
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          runSecurityAction(
                            onLogoutSessions,
                          )
                        }
                        className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
                      >
                        {securityAction === "sessions"
                          ? "Abmelden …"
                          : "Alle Sitzungen abmelden"}
                      </button>
                    </div>
                  </section>
                )}
              </div>

              <footer className="flex justify-end gap-3 border-t border-fb-border bg-fb-surface px-5 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
                >
                  Abbrechen
                </button>

                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Speichern …"
                    : editing
                      ? "Änderungen speichern"
                      : "Benutzer anlegen"}
                </button>
              </footer>
            </form>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
