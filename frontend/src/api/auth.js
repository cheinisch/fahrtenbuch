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
    throw new ApiError(
      body?.error?.message || "Die Anfrage ist fehlgeschlagen.",
      response.status,
      body?.error?.code || "REQUEST_FAILED",
    );
  }

  return body;
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