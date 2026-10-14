import md5 from "blueimp-md5";

/** Event, mit dem die Profilseite eine geänderte Gravatar-Einstellung an die Kopfzeile meldet. */
export const GRAVATAR_SETTING_EVENT = "fahrtenbuch:gravatar-setting";

async function hashEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  // SHA-256 empfiehlt Gravatar; crypto.subtle gibt es nur in sicheren Kontexten (HTTPS/localhost)
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return md5(normalized);
}

/**
 * Gravatar-URL zur E-Mail-Adresse oder null. `d=404`: ohne hinterlegtes Bild liefert
 * Gravatar einen Fehler statt eines Platzhalters, dann bleiben die Initialen stehen.
 */
export async function gravatarUrl(email, size = 80) {
  if (!email || !String(email).includes("@")) return null;
  return `https://www.gravatar.com/avatar/${await hashEmail(email)}?s=${size}&d=404`;
}
