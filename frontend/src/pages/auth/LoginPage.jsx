import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../../api/authApi.js";

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();

    setError("");
    setIsSubmitting(true);

    try {
      const data = await login({ email, password });

      localStorage.setItem("accessToken", data.accessToken);
      navigate("/");
    } catch {
      setError("Anmeldung fehlgeschlagen. Bitte prüfe deine Zugangsdaten.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface)] px-4 py-8 text-[var(--color-text)]">
      <section className="w-full max-w-md">
        <form
          className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-main)] p-6 shadow-xl sm:p-8"
          onSubmit={submit}
        >
          <div className="bg-red-500 text-white p-8 rounded-xl">
  Tailwind funktioniert
</div>
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent-soft)]">
              <svg
                aria-hidden="true"
                className="h-7 w-7 text-[var(--color-accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 4.75A1.75 1.75 0 0 1 6.75 3h8.5A1.75 1.75 0 0 1 17 4.75v14.5A1.75 1.75 0 0 1 15.25 21h-8.5A1.75 1.75 0 0 1 5 19.25V4.75Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 8.5h6M8 12h6M8 15.5h3"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Fahrtenbuch anmelden
            </h1>

            <p className="mt-2 text-sm text-[var(--color-muted-text)]">
              Melde dich mit deiner E-Mail-Adresse und deinem Passwort an.
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-semibold"
              >
                E-Mail
              </label>

              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@beispiel.de"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={isSubmitting}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-muted-text)] focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-semibold"
              >
                Passwort
              </label>

              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Passwort eingeben"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={isSubmitting}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-muted-text)] focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-danger)]"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 flex w-full items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-3 font-semibold text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Anmeldung läuft …" : "Anmelden"}
          </button>

          <div className="mt-6 text-center">
            <button
              type="button"
              className="text-sm font-medium text-[var(--color-accent-secondary)] transition hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              Passwort vergessen?
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}