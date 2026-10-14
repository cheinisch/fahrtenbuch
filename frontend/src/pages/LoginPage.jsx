import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ApiError,
  getPasskeyLoginOptions,
  requestPasswordReset,
  verifyPasskeyLogin,
} from "../api/auth.js";
import { authenticateWithPasskey } from "../lib/webauthn.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import AuthLayout, { authInputClass, authPrimaryButtonClass } from "../components/AuthLayout.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = typeof location.state?.from === "string" && location.state.from.startsWith("/")
    ? location.state.from
    : "/";
  const { signIn, completeSignIn } = useAuth();
  const { t } = useI18n();

  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [totpRequired, setTotpRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [resetRequested, setResetRequested] = useState(false);

  function switchMode(next) {
    setMode(next);
    setErrorMessage("");
    setResetRequested(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      await signIn(
        {
          email: email.trim(),
          password,
          totpCode: totpCode || undefined,
        },
        rememberMe,
      );
      navigate(returnTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "MFA_REQUIRED") {
        setTotpRequired(true);
        setErrorMessage(t("login.mfaRequired"));
      } else {
        setErrorMessage(error instanceof Error ? error.message : t("login.failed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      await requestPasswordReset(email.trim());
      setResetRequested(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("login.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasskeyLogin() {
    setSubmitting(true);
    setErrorMessage("");

    try {
      const options = await getPasskeyLoginOptions();
      const credential = await authenticateWithPasskey(options);
      const result = await verifyPasskeyLogin(credential);
      completeSignIn(result, rememberMe);
      navigate(returnTo, { replace: true });
    } catch (error) {
      if (error?.name !== "NotAllowedError") {
        setErrorMessage(error instanceof Error ? error.message : t("login.passkeyFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const errorBox = errorMessage && (
    <div role="alert" className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">
      {errorMessage}
    </div>
  );

  if (mode === "forgot") {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("login.forgotTitle")}</h1>
        <p className="mt-2 text-fb-muted">{t("login.forgotHint")}</p>

        {resetRequested ? (
          <div role="status" className="mt-8 rounded-xl border border-fb-accent bg-fb-accent-soft p-4 text-sm text-fb-accent">
            {t("login.forgotSent")}
          </div>
        ) : (
          <form onSubmit={handleForgot} className="mt-8 space-y-5">
            <label className="block text-sm font-medium">
              {t("login.email")}
              <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} className={authInputClass} />
            </label>
            {errorBox}
            <button type="submit" disabled={submitting} className={authPrimaryButtonClass}>
              {submitting ? t("login.forgotSending") : t("login.forgotSubmit")}
            </button>
          </form>
        )}

        <button type="button" onClick={() => switchMode("login")} className="mt-6 min-h-11 text-sm font-semibold text-fb-accent hover:text-fb-accent-secondary">
          {t("login.backToLogin")}
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("login.title")}</h1>
      <p className="mt-2 text-fb-muted">{t("login.welcome")}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <label className="block text-sm font-medium">
          {t("login.email")}
          <input id="email" name="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} className={authInputClass} />
        </label>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="text-sm font-medium">{t("login.password")}</label>
            <button type="button" onClick={() => switchMode("forgot")} className="text-sm font-medium text-fb-accent hover:text-fb-accent-secondary">
              {t("login.forgot")}
            </button>
          </div>
          <input id="password" name="password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} className={authInputClass} />
        </div>

        {totpRequired && (
          <label className="block rounded-xl border border-fb-border bg-fb-main p-4 text-sm font-medium">
            {t("login.totp")}
            <input
              id="totp-code"
              name="totp-code"
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={submitting}
              className={`${authInputClass} bg-fb-surface tracking-[0.3em]`}
            />
          </label>
        )}

        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} disabled={submitting} className="size-4 accent-[var(--color-accent)]" />
          {t("login.remember")}
        </label>

        {errorBox}

        <button type="submit" disabled={submitting} className={authPrimaryButtonClass}>
          {submitting ? t("login.submitting") : t("login.submit")}
        </button>
      </form>

      <div className="mt-8 flex items-center gap-3 text-sm text-fb-muted">
        <span className="h-px flex-1 bg-fb-border" />
        {t("login.or")}
        <span className="h-px flex-1 bg-fb-border" />
      </div>

      <button
        type="button"
        onClick={handlePasskeyLogin}
        disabled={submitting}
        className="mt-6 flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-fb-border bg-fb-main px-4 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 7-7" />
          <path d="m16 7 2 2" />
          <path d="m14 9 2 2" />
        </svg>
        {t("login.passkey")}
      </button>
    </AuthLayout>
  );
}
