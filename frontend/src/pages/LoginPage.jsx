import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../api/auth.js";
import { useAuth } from "../auth/AuthProvider.jsx";

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [totpRequired, setTotpRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

      navigate("/", { replace: true });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "MFA_REQUIRED"
      ) {
        setTotpRequired(true);
        setErrorMessage(
          "Bitte gib deinen Zwei-Faktor-Code ein.",
        );
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Die Anmeldung ist fehlgeschlagen.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handlePasskeyLogin() {
    setErrorMessage(
      "Die Passkey-Anmeldung ist derzeit noch nicht angebunden.",
    );
  }

  return (
    <>
      <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="mt-6 text-center text-2xl/9 font-bold tracking-tight text-white">
            Bei Fahrtenbuch anmelden
          </h2>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
          <div className="bg-fb-main px-6 py-12 outline -outline-offset-1 outline-white/10 sm:rounded-lg sm:px-12">
            <form
              onSubmit={handleSubmit}
              className="space-y-6"
            >
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm/6 font-medium text-white"
                >
                  E-Mail-Adresse
                </label>

                <div className="mt-2">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    disabled={submitting}
                    className="block w-full rounded-md bg-white/5 px-3 py-1.5 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-gray-500 focus:outline-2 focus:-outline-offset-2 focus:outline-fb-accent disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm/6"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm/6 font-medium text-white"
                >
                  Passwort
                </label>

                <div className="mt-2">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    disabled={submitting}
                    className="block w-full rounded-md bg-white/5 px-3 py-1.5 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-gray-500 focus:outline-2 focus:-outline-offset-2 focus:outline-fb-accent disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm/6"
                  />
                </div>
              </div>

              {totpRequired && (
                <div>
                  <label
                    htmlFor="totp-code"
                    className="block text-sm/6 font-medium text-white"
                  >
                    Zwei-Faktor-Code
                  </label>

                  <div className="mt-2">
                    <input
                      id="totp-code"
                      name="totp-code"
                      type="text"
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={totpCode}
                      onChange={(event) =>
                        setTotpCode(
                          event.target.value
                            .replace(/\D/g, "")
                            .slice(0, 6),
                        )
                      }
                      disabled={submitting}
                      className="block w-full rounded-md bg-white/5 px-3 py-1.5 text-base tracking-[0.25em] text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-gray-500 focus:outline-2 focus:-outline-offset-2 focus:outline-fb-accent disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm/6"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex gap-3">
                  <div className="flex h-6 shrink-0 items-center">
                    <div className="group grid size-4 grid-cols-1">
                      <input
                        id="remember-me"
                        name="remember-me"
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(event) =>
                          setRememberMe(event.target.checked)
                        }
                        disabled={submitting}
                        className="col-start-1 row-start-1 appearance-none rounded-sm border border-white/10 bg-white/5 checked:border-indigo-500 checked:bg-indigo-500 indeterminate:border-indigo-500 indeterminate:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:border-gray-300 disabled:bg-gray-100 disabled:checked:bg-gray-100 forced-colors:appearance-auto"
                      />

                      <svg
                        fill="none"
                        viewBox="0 0 14 14"
                        aria-hidden="true"
                        className="pointer-events-none col-start-1 row-start-1 size-3.5 self-center justify-self-center stroke-white group-has-disabled:stroke-white/25"
                      >
                        <path
                          d="M3 8L6 11L11 3.5"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="opacity-0 group-has-checked:opacity-100"
                        />

                        <path
                          d="M3 7H11"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="opacity-0 group-has-indeterminate:opacity-100"
                        />
                      </svg>
                    </div>
                  </div>

                  <label
                    htmlFor="remember-me"
                    className="block text-sm/6 text-white"
                  >
                    Angemeldet bleiben
                  </label>
                </div>

                <div className="text-sm/6">
                  <a
                    href="#"
                    className="font-semibold text-fb-accent hover:text-fb-accent-secondary"
                  >
                    Passwort vergessen?
                  </a>
                </div>
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-md border border-fb-danger px-3 py-2 text-sm text-fb-danger"
                >
                  {errorMessage}
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full justify-center rounded-md bg-fb-accent px-3 py-1.5 text-sm/6 font-semibold text-fb-accent-text hover:bg-fb-accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting
                    ? "Anmeldung läuft …"
                    : "Anmelden"}
                </button>
              </div>
            </form>

            <div>
              <div className="mt-10 flex items-center gap-x-6">
                <div className="w-full flex-1 border-t border-white/10" />

                <p className="text-sm/6 font-medium text-nowrap text-white">
                  Oder anmelden mit
                </p>

                <div className="w-full flex-1 border-t border-white/10" />
              </div>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={handlePasskeyLogin}
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-3 rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white inset-ring inset-ring-white/5 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="size-5"
                  >
                    <circle cx="8" cy="15" r="4" />
                    <path d="m11 12 7-7" />
                    <path d="m16 7 2 2" />
                    <path d="m14 9 2 2" />
                  </svg>

                  <span className="text-sm/6 font-semibold">
                    Mit Passkey anmelden
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}