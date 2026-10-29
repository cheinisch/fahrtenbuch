import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ApiError,
  exchangeOAuthTicket,
  getAuthMethods,
  getOAuthProviders,
  getPasskeyLoginOptions,
  requestPasswordReset,
  startOAuthLogin,
  verifyPasskeyLogin,
} from "../api/auth.js";
import { authenticateWithPasskey } from "../lib/webauthn.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import AuthLayout, { authInputClass, authPrimaryButtonClass } from "../components/AuthLayout.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { codeKey } from "../i18n/translate.js";
import { scopedStorageKey } from "../lib/basePath.js";

// Überlebt die Weiterleitung zum Anbieter und zurück
const OAUTH_PENDING_KEY = scopedStorageKey("fahrtenbuch.oauthPending");

function readOAuthPending() {
  try {
    return JSON.parse(sessionStorage.getItem(OAUTH_PENDING_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function writeOAuthPending(value) {
  try {
    if (value) sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(OAUTH_PENDING_KEY);
  } catch {
    // Ohne sessionStorage gelten die Standardwerte
  }
}

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
  const [oauthProviders, setOAuthProviders] = useState([]);
  // Serverweit abschaltbar (PASSKEYS_ENABLED); bis zur Antwort anzeigen
  const [passkeysAvailable, setPasskeysAvailable] = useState(true);
  // Ticket aus dem Callback, solange noch der TOTP-Code fehlt
  const [oauthTicket, setOAuthTicket] = useState("");
  const [oauthCompleting, setOAuthCompleting] = useState(false);
  const oauthHandled = useRef(false);

  function oauthErrorMessage(code) {
    return t(`oauth.errors.${codeKey(code)}`, t("oauth.errors.default"));
  }

  async function finishOAuth(ticket, code) {
    const pending = readOAuthPending();
    const result = await exchangeOAuthTicket(ticket, code);
    writeOAuthPending(null);
    completeSignIn(result, Boolean(pending.remember));
    const target = typeof pending.returnTo === "string" && pending.returnTo.startsWith("/")
      ? pending.returnTo
      : "/";
    navigate(target, { replace: true });
  }

  useEffect(() => {
    let active = true;
    getOAuthProviders()
      .then((providers) => {
        if (active) setOAuthProviders(providers.filter((provider) => provider.enabled));
      })
      .catch(() => {});
    getAuthMethods()
      .then((methods) => {
        if (active) setPasskeysAvailable(methods.passkeys !== false);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Rückkehr vom Anbieter: Ticket im Fragment oder Fehlercode in der Query
  useEffect(() => {
    if (oauthHandled.current) return;
    oauthHandled.current = true;

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const ticket = hashParams.get("oauthTicket");
    const queryParams = new URLSearchParams(window.location.search);
    const oauthError = queryParams.get("oauthError");

    if (!ticket && !oauthError) return;

    // Ticket und Fehler sofort aus der Adresszeile entfernen
    window.history.replaceState(window.history.state, "", window.location.pathname);

    if (oauthError) {
      writeOAuthPending(null);
      setErrorMessage(oauthErrorMessage(oauthError));
      return;
    }

    setRememberMe(Boolean(readOAuthPending().remember));
    setOAuthCompleting(true);
    finishOAuth(ticket)
      .catch((error) => {
        if (error instanceof ApiError && error.code === "MFA_REQUIRED") {
          setOAuthTicket(ticket);
        } else {
          writeOAuthPending(null);
          setErrorMessage(
            error instanceof ApiError ? oauthErrorMessage(error.code) : t("login.failed"),
          );
        }
      })
      .finally(() => setOAuthCompleting(false));
  }, []);

  async function handleOAuthStart(provider) {
    setSubmitting(true);
    setErrorMessage("");

    try {
      writeOAuthPending({ remember: rememberMe, returnTo });
      const { authorizationUrl } = await startOAuthLogin(provider.id);
      window.location.assign(authorizationUrl);
    } catch (error) {
      writeOAuthPending(null);
      setErrorMessage(
        error instanceof ApiError ? oauthErrorMessage(error.code) : t("login.failed"),
      );
      setSubmitting(false);
    }
  }

  async function handleOAuthTotp(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      await finishOAuth(oauthTicket, totpCode);
    } catch (error) {
      if (error instanceof ApiError && error.code === "OAUTH_TICKET_INVALID") {
        setOAuthTicket("");
        setTotpCode("");
        setErrorMessage(oauthErrorMessage(error.code));
      } else {
        setErrorMessage(error instanceof Error ? error.message : t("login.failed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

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

  if (oauthCompleting) {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("login.title")}</h1>
        <p role="status" className="mt-4 text-fb-muted">{t("oauth.completing")}</p>
      </AuthLayout>
    );
  }

  if (oauthTicket) {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("login.totp")}</h1>
        <p className="mt-2 text-fb-muted">{t("oauth.mfaHint")}</p>

        <form onSubmit={handleOAuthTotp} className="mt-8 space-y-5">
          <label className="block text-sm font-medium">
            {t("login.totp")}
            <input
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={submitting}
              className={`${authInputClass} tracking-[0.3em]`}
            />
          </label>
          {errorBox}
          <button type="submit" disabled={submitting || totpCode.length !== 6} className={authPrimaryButtonClass}>
            {submitting ? t("login.submitting") : t("login.submit")}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setOAuthTicket("");
            setTotpCode("");
            setErrorMessage("");
            writeOAuthPending(null);
          }}
          className="mt-6 min-h-11 text-sm font-semibold text-fb-accent hover:text-fb-accent-secondary"
        >
          {t("oauth.cancel")}
        </button>
      </AuthLayout>
    );
  }

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

      {(passkeysAvailable || oauthProviders.length > 0) && (
        <div className="mt-8 flex items-center gap-3 text-sm text-fb-muted">
          <span className="h-px flex-1 bg-fb-border" />
          {t("login.or")}
          <span className="h-px flex-1 bg-fb-border" />
        </div>
      )}

      <div className="mt-6 space-y-3">
      {passkeysAvailable && (
      <button
        type="button"
        onClick={handlePasskeyLogin}
        disabled={submitting}
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-fb-border bg-fb-main px-4 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 7-7" />
          <path d="m16 7 2 2" />
          <path d="m14 9 2 2" />
        </svg>
        {t("login.passkey")}
      </button>
      )}

      {oauthProviders.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => handleOAuthStart(provider)}
          disabled={submitting}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-fb-border bg-fb-main px-4 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
          {t("oauth.signInWith", { provider: provider.name })}
        </button>
      ))}
      </div>
    </AuthLayout>
  );
}
