import { useState } from "react";
import { login } from "../api/auth.js";

export default function LoginPage() {
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
      [name]: value,
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

      window.location.href = "/";
    } catch (error) {
      setStatus({
        loading: false,
        error: error.message,
      });
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <section
        className="w-full max-w-md rounded-3xl border p-8 shadow-xl"
        style={{
          background: "var(--color-main)",
          borderColor: "var(--color-border)",
        }}
      >
        <header className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold"
            style={{
              background: "var(--color-accent)",
              color: "var(--color-accent-text)",
            }}
          >
            F
          </div>

          <h1 className="text-3xl font-bold">Fahrtenbuch</h1>

          <p
            className="mt-2"
            style={{
              color: "var(--color-muted-text)",
            }}
          >
            Melde dich an, um deine Fahrten zu verwalten.
          </p>
        </header>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">
              E-Mail-Adresse
            </span>

            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={updateField}
              className="w-full rounded-xl border px-4 py-3 outline-none"
              style={{
                background: "var(--color-surface)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">Passwort</span>

            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={updateField}
              className="w-full rounded-xl border px-4 py-3 outline-none"
              style={{
                background: "var(--color-surface)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">
              Zwei-Faktor-Code
            </span>

            <input
              type="text"
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={form.totp}
              onChange={updateField}
              placeholder="Optional"
              className="w-full rounded-xl border px-4 py-3 outline-none"
              style={{
                background: "var(--color-surface)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            />
          </label>

          {status.error && (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{
                color: "var(--color-danger)",
                borderColor: "var(--color-danger)",
              }}
            >
              {status.error}
            </div>
          )}

          <button
            type="submit"
            disabled={status.loading}
            className="w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-60"
            style={{
              background: "var(--color-accent)",
              color: "var(--color-accent-text)",
            }}
          >
            {status.loading ? "Anmeldung läuft …" : "Anmelden"}
          </button>

          <button
            type="button"
            className="w-full rounded-xl border px-4 py-3 font-medium"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            Mit Passkey anmelden
          </button>
        </form>

        <footer className="mt-6 text-center">
          <a
            href="/forgot-password"
            className="text-sm font-medium"
            style={{
              color: "var(--color-accent-secondary)",
            }}
          >
            Passwort vergessen?
          </a>
        </footer>
      </section>
    </main>
  );
}