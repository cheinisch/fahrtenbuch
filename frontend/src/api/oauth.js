import { translate } from "../i18n/translate.js";
import { ApiError } from "./auth.js";
import { authenticatedFetch } from "./app.js";

async function request(accessToken, path, options = {}) {
  const response = await authenticatedFetch(accessToken, path, {
    ...options,
    // Der Start setzt einen Bindungs-Cookie für den Callback
    credentials: "same-origin",
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
    const code = typeof body?.error === "string" ? body.error : body?.error?.code;
    throw new ApiError(
      body?.message || body?.error?.message || translate("common.requestFailed"),
      response.status,
      code || "OAUTH_REQUEST_FAILED",
    );
  }
  return body;
}

export const getLinkedAccounts = (accessToken) =>
  request(accessToken, "/api/v1/auth/oauth/identities");

export const startAccountLink = (accessToken, provider) =>
  request(accessToken, `/api/v1/auth/oauth/${encodeURIComponent(provider)}/link`, {
    method: "POST",
  });

export const unlinkAccount = (accessToken, id) =>
  request(accessToken, `/api/v1/auth/oauth/identities/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
