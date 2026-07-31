import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../api/auth.js";

function EyeIcon({ crossed = false }) {
  if (crossed) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="size-5"
        aria-hidden="true"
      >
        <path d="m3 3 18 18" />
        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
        <path d="M9.8 4.3A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 8a10 10 0 0 1-2.2 3.8" />
        <path d="M6.2 6.2C4.1 7.7 3 10.2 3 12c0 3 3.5 8 9 8a10.5 10.5 0 0 0 4.1-.8" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="size-5"
      aria-hidden="true"
    >
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 7-7" />
      <path d="m16 7 2 2" />
      <path d="m14 9 2 2" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [form, setForm] = useState({
    email: "",
    password: "",
    totp: "",
  });

  const [status, setStatus] = useState({
    loading: false,
    error: "",
  });

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]:
        name === "totp"
          ? value.replace(/\D/g, "").slice(0, 6)
          : value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setStatus({
      loading: true,
      error: "",
    });

    try {
      const result = await login(form);

      if (result.accessToken) {
        sessionStorage.setItem("accessToken", result.accessToken);
      }

      if (rememberMe) {
        localStorage.setItem("fahrtenbuchRememberEmail", form.email);
      } else {
        localStorage.removeItem("fahrtenbuchRememberEmail");
      }

      navigate("/", { replace: true });
    } catch (error) {
      setStatus({
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Die Anmeldung ist fehlgeschlagen.",
      });
    }
  }

  function handlePasskeyLogin() {
    setStatus({
      loading: false,
      error: "Die Passkey-Anmeldung ist noch nicht angebunden.",
    });
  }

  return (
    <main className="flex min-h-screen flex-col justify-center bg-fb-surface px-4 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-fb-accent text-2xl font-bold text-fb-accent-text shadow-sm">
          F
        </div>

        <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-fb-text">
          Fahrtenbuch
        </h1>

        <p className="mt-2 text-center text-sm text-fb-muted">
          Melde dich an, um deine Fahrten zu verwalten.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-[480px]">
        <section className="border border-fb-border bg-fb-main px-6 py-10 shadow-xl sm:rounded-2xl sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-fb-text"
              >
                E-Mail-Adresse
              </label>

              <div className="mt-2">
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={updateField}
                  required
                  autoComplete="email"
                  placeholder="deine@email.de"
                  disabled={status.loading}
                  className="block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-base text-fb-text outline-none transition placeholder:text-fb-muted focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-fb-text"
                >
                  Passwort
                </label>

                <Link
                  to="/forgot-password"
                  className="text-sm font-semibold text-fb-accent transition hover:text-fb-accent-secondary"
                >
                  Passwort vergessen?
                </Link>
              </div>

              <div className="relative mt-2">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={updateField}
                  required
                  autoComplete="current-password"
                  placeholder="Dein Passwort"
                  disabled={status.loading}
                  className="block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 pr-11 text-base text-fb-text outline-none transition placeholder:text-fb-muted focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-fb-muted transition hover:text-fb-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fb-accent"
                  aria-label={
                    showPassword
                      ? "Passwort verbergen"
                      : "Passwort anzeigen"
                  }
                >
                  <EyeIcon crossed={showPassword} />
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="totp"
                className="block text-sm font-medium text-fb-text"
              >
                Zwei-Faktor-Code
                <span className="ml-1 font-normal text-fb-muted">
                  (optional)
                </span>
              </label>

              <div className="mt-2">
                <input
                  id="totp"
                  name="totp"
                  type="text"
                  value={form.totp}
                  onChange={updateField}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  disabled={status.loading}
                  className="block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-base tracking-[0.2em] text-fb-text outline-none transition placeholder:tracking-normal placeholder:text-fb-muted focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                />
              </div>
            </div>

            <div className="flex items-center">
              <div className="group grid size-4 grid-cols-1">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="col-start-1 row-start-1 appearance-none rounded border border-fb-border bg-fb-surface checked:border-fb-accent checked:bg-fb-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent"
                />

                <svg
                  viewBox="0 0 14 14"
                  fill="none"
                  className="pointer-events-none col-start-1 row-start-1 size-3.5 self-center justify-self-center stroke-fb-accent-text opacity-0 group-has-checked:opacity-100"
                  aria-hidden="true"
                >
                  <path
                    d="M3 8L6 11L11 3.5"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <label
                htmlFor="remember-me"
                className="ml-3 block text-sm text-fb-text"
              >
                E-Mail-Adresse merken
              </label>
            </div>

            {status.error && (
              <div
                role="alert"
                className="rounded-lg border border-fb-danger bg-fb-danger-soft px-4 py-3 text-sm text-fb-danger"
              >
                {status.error}
              </div>
            )}

            <button
              type="submit"
              disabled={status.loading}
              className="flex w-full justify-center rounded-lg bg-fb-accent px-3 py-2.5 text-sm font-semibold text-fb-accent-text shadow-sm transition hover:bg-fb-accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status.loading ? "Anmeldung läuft …" : "Anmelden"}
            </button>
          </form>

          <div className="mt-8 flex items-center gap-5">
            <div className="h-px flex-1 bg-fb-border" />
            <p className="text-sm font-medium text-fb-muted">oder</p>
            <div className="h-px flex-1 bg-fb-border" />
          </div>

          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={status.loading}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:bg-fb-accent-soft hover:text-fb-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <KeyIcon />
            Mit Passkey anmelden
          </button>
        </section>
      </div>
    </main>
  );
}