import { ApiError } from "./auth.js";

async function request(accessToken, path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      body?.error?.message || body?.message || "Die Passkey-Anfrage ist fehlgeschlagen.",
      response.status,
      body?.error?.code || "PASSKEY_REQUEST_FAILED",
    );
  }
  return body;
}

export const getPasskeys = (accessToken) =>
  request(accessToken, "/api/v1/auth/passkeys");

export const getPasskeyRegistrationOptions = (accessToken) =>
  request(accessToken, "/api/v1/auth/passkeys/register/options", { method: "POST" });

export const verifyPasskeyRegistration = (accessToken, credential, name) =>
  request(accessToken, "/api/v1/auth/passkeys/register/verify", {
    method: "POST",
    body: JSON.stringify({ ...credential, name }),
  });

export const renamePasskey = (accessToken, id, name) =>
  request(accessToken, `/api/v1/auth/passkeys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const deletePasskey = (accessToken, id) =>
  request(accessToken, `/api/v1/auth/passkeys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
