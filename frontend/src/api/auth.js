export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // Server liefert { error: "CODE", message }; ältere Form { error: { code, message } } weiter unterstützen
    const code = typeof body?.error === "string" ? body.error : body?.error?.code;
    throw new ApiError(
      body?.message || body?.error?.message || "Die Anfrage ist fehlgeschlagen.",
      response.status,
      code || "REQUEST_FAILED",
    );
  }

  return body;
}

export function getAuthMethods() {
  return request("/api/v1/auth/methods");
}

export function getOAuthProviders() {
  return request("/api/v1/auth/oauth/providers");
}

export function startOAuthLogin(provider) {
  return request(`/api/v1/auth/oauth/${encodeURIComponent(provider)}/login`, {
    method: "POST",
    credentials: "same-origin",
  });
}

export function exchangeOAuthTicket(ticket, totpCode) {
  return request("/api/v1/auth/oauth/exchange", {
    method: "POST",
    body: JSON.stringify({
      ticket,
      totpCode: totpCode || null,
      deviceName: "Webbrowser",
      platform: navigator.userAgentData?.platform || navigator.platform || "web",
    }),
  });
}

export function login(credentials) {
  return request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
      totpCode: credentials.totpCode || null,
      deviceName: "Webbrowser",
    }),
  });
}

export function refresh(refreshToken) {
  return request("/api/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function getCurrentUser(accessToken) {
  return request("/api/v1/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function logout(accessToken) {
  return request("/api/v1/auth/logout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function getPasskeyLoginOptions() {
  return request("/api/v1/auth/passkeys/login/options", {
    method: "POST",
  });
}

export function verifyPasskeyLogin(credential) {
  return request("/api/v1/auth/passkeys/login/verify", {
    method: "POST",
    body: JSON.stringify({
      ...credential,
      deviceName: "Webbrowser",
      platform: navigator.userAgentData?.platform || navigator.platform || "web",
    }),
  });
}

export function requestPasswordReset(email) {
  return request("/api/v1/auth/password/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token, password) {
  return request("/api/v1/auth/password/reset", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}
