import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { resetPassword } from "../api/auth.js";
import AuthLayout, { authInputClass, authPrimaryButtonClass } from "../components/AuthLayout.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

// Ziel des Links aus der Reset-Mail (PASSWORD_RESET_URL, Standard: /password-reset?token=…).
export default function PasswordResetPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(t("passwordReset.tooShort"));
      return;
    }
    if (password !== confirmation) {
      setError(t("passwordReset.mismatch"));
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : t("passwordReset.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("passwordReset.title")}</h1>

      {!token ? (
        <p role="alert" className="mt-6 rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{t("passwordReset.missingToken")}</p>
      ) : done ? (
        <p role="status" className="mt-6 rounded-xl border border-fb-accent bg-fb-accent-soft p-4 text-sm text-fb-accent">{t("passwordReset.success")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <label className="block text-sm font-medium">
            {t("passwordReset.newPassword")}
            <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} className={authInputClass} />
          </label>
          <label className="block text-sm font-medium">
            {t("passwordReset.confirm")}
            <input type="password" required minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={submitting} className={authInputClass} />
          </label>
          {error && <div role="alert" className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{error}</div>}
          <button type="submit" disabled={submitting} className={authPrimaryButtonClass}>
            {submitting ? t("common.saving") : t("passwordReset.submit")}
          </button>
        </form>
      )}

      <Link to="/login" className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-fb-accent hover:text-fb-accent-secondary">
        {t("login.backToLogin")}
      </Link>
    </AuthLayout>
  );
}
