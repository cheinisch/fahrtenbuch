import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth.js";

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M4 6.5h16v11H4z" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M12 3 19 6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10V6z" />
    </svg>
  );
}

function EyeIcon({ hidden = false }) {
  return hidden ? (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.7A2 2 0 0 0 13.3 13.4" />
      <path d="M9.8 4.3A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 8a9.8 9.8 0 0 1-2.2 3.8" />
      <path d="M6.2 6.2C4.1 7.7 3 10.2 3 12c0 3 3.5 8 9 8a10.5 10.5 0 0 0 4.1-.8" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="h-5 w-5"
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
      aria-hidden="true"
      className="h-5 w-5"
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
      error: "Die Passkey-Anmeldung wird im nächsten Schritt eingebunden.",
    });
  }

  return (
    <main className="login-background relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6">
      <div
        className="pointer-events-none absolute -left-32 bottom-[-180px] h-[420px] w-[620px] rotate-[-8deg] rounded-[50%] border-[42px] border-fb-accent-soft opacity-60"
        aria-hidden="true"
      />

      <div
        className="pointer-events-none absolute right-[-100px] top-[-80px] h-80 w-80 rounded-full bg-fb-accent-soft opacity-50 blur-3xl"
        aria-hidden="true"
      />

      <section className="relative z-10 w-full max-w-[500px] rounded-[28px] border border-fb-border bg-fb-main px-6 py-8 shadow-[0_24px_70px_rgba(0,0,0,0.12)] sm:px-10 sm:py-10">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-fb-accent-soft">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-fb-accent text-3xl font-bold text-fb-accent-text shadow-md">
              F
            </div>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-fb-text sm:text-4xl">
            Fahrtenbuch
          </h1>

          <p className="mt-3 text-base text-fb-muted">
            Melde dich an, um deine Fahrten zu verwalten.
          </p>

          <div className="mx-auto mt-6 h-0.5 w-20 rounded-full bg-fb-accent" />
        </header>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-semibold text-fb-text"
            >
              E-Mail-Adresse
            </label>

            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-fb-accent">
                <MailIcon />
              </span>

              <input
                id="email"
                type="email"
                name="email"
                value={form.email}
                onChange={updateField}
                autoComplete="email"
                placeholder="deine@email.de"
                required
                disabled={status.loading}
                className="h-14 w-full rounded-xl border border-fb-border bg-fb-surface pl-12 pr-4 text-base text-fb-text outline-none transition placeholder:text-fb-muted focus:border-fb-accent focus:ring-4 focus:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-semibold text-fb-text"
            >
              Passwort
            </label>

            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-fb-accent">
                <LockIcon />
              </span>

              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                value={form.password}
                onChange={updateField}
                autoComplete="current-password"
                placeholder="Dein Passwort"
                required
                disabled={status.loading}
                className="h-14 w-full rounded-xl border border-fb-border bg-fb-surface pl-12 pr-12 text-base text-fb-text outline-none transition placeholder:text-fb-muted focus:border-fb-accent focus:ring-4 focus:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
              />

              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-fb-muted transition hover:text-fb-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fb-accent"
                aria-label={
                  showPassword ? "Passwort verbergen" : "Passwort anzeigen"
                }
              >
                <EyeIcon hidden={showPassword} />
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="totp"
              className="mb-2 block text-sm font-semibold text-fb-text"
            >
              Zwei-Faktor-Code{" "}
              <span className="font-normal text-fb-muted">(optional)</span>
            </label>

            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-fb-accent">
                <ShieldIcon />
              </span>

              <input
                id="totp"
                type="text"
                name="totp"
                value={form.totp}
                onChange={updateField}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                disabled={status.loading}
                className="h-14 w-full rounded-xl border border-fb-border bg-fb-surface pl-12 pr-4 text-base tracking-[0.25em] text-fb-text outline-none transition placeholder:tracking-normal placeholder:text-fb-muted focus:border-fb-accent focus:ring-4 focus:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          {status.error && (
            <div
              role="alert"
              className="rounded-xl border border-fb-danger bg-fb-danger-soft px-4 py-3 text-sm text-fb-danger"
            >
              {status.error}
            </div>
          )}

          <button
            type="submit"
            disabled={status.loading}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-fb-accent px-5 text-base font-bold text-fb-accent-text shadow-sm transition hover:bg-fb-accent-secondary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status.loading ? "Anmeldung läuft …" : "Anmelden"}
          </button>

          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={status.loading}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-xl border-2 border-fb-accent bg-transparent px-5 text-base font-semibold text-fb-accent transition hover:bg-fb-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fb-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            <KeyIcon />
            Mit Passkey anmelden
          </button>
        </form>

        <div className="my-7 flex items-center gap-4">
          <div className="h-px flex-1 bg-fb-border" />
          <span className="text-sm text-fb-muted">oder</span>
          <div className="h-px flex-1 bg-fb-border" />
        </div>

        <footer className="text-center">
          <a
            href="/forgot-password"
            className="text-sm font-semibold text-fb-accent transition hover:text-fb-accent-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-accent"
          >
            Passwort vergessen?
          </a>
        </footer>
      </section>
    </main>
  );
}