import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  EyeIcon,
  EyeSlashIcon,
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
    role: user?.role || "user",
    status: user?.status || "active",
    locale: user?.locale || "de",
    timezone:
      user?.timezone || "Europe/Berlin",
    themeMode:
      user?.themeMode || "system",
    forcePasswordChange:
      user?.forcePasswordChange ?? true,
    password: "",
    passwordConfirmation: "",
  };
}

export default function UserEditorModal({
  open,
  user,
  currentUserId,
  saving,
  onClose,
  onSubmit,
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
      displayName:
        form.displayName.trim() || null,
      role: form.role,
    };

    if (form.loginName.trim()) {
      payload.loginName =
        form.loginName.trim();
    }

    if (editing) {
      payload.status = form.status;
      payload.locale = form.locale;
      payload.timezone =
        form.timezone.trim();
      payload.themeMode =
        form.themeMode;
      payload.forcePasswordChange =
        form.forcePasswordChange;
    }

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

  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
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
                  {editing
                    ? "Benutzer bearbeiten"
                    : "Benutzer anlegen"}
                </DialogTitle>

                <p className="mt-1 text-sm text-fb-muted">
                  {editing
                    ? "Profildaten, Rolle, Status und Passwort verwalten."
                    : "Lege ein neues Konto mit einem vorläufigen Passwort an."}
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg p-2 text-fb-muted transition hover:bg-fb-surface hover:text-fb-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent disabled:opacity-50"
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
                    Konto
                  </h3>

                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
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
                        maxLength={120}
                        className={fieldClass}
                        placeholder="z. B. Christian Heinisch"
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
                        placeholder="Wird sonst aus der E-Mail erzeugt"
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

                    {editing && (
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

                        {editingOwnAccount && (
                          <span className="mt-1 block text-xs text-fb-muted">
                            Das eigene Konto kann nicht
                            deaktiviert werden.
                          </span>
                        )}
                      </label>
                    )}
                  </div>
                </section>

                {editing && (
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
                )}

                <section className="border-t border-fb-border pt-6">
                  <h3 className="text-sm font-bold text-fb-text">
                    Passwort
                  </h3>

                  <p className="mt-1 text-sm text-fb-muted">
                    {editing
                      ? "Leer lassen, um das bestehende Passwort nicht zu ändern. Bei einer Änderung werden bestehende Sitzungen beendet."
                      : "Das Startpasswort wird sicher gehasht gespeichert."}
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
                          aria-label={
                            showPassword
                              ? "Passwort verbergen"
                              : "Passwort anzeigen"
                          }
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
                        Für neu angelegte Benutzer wird
                        dies automatisch aktiviert.
                      </span>
                    </span>
                  </label>
                </section>
              </div>

              <footer className="flex justify-end gap-3 border-t border-fb-border bg-fb-surface px-5 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
                >
                  Abbrechen
                </button>

                <button
                  type="submit"
                  disabled={saving}
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
