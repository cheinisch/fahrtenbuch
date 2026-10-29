// Unterpfad, unter dem die Web-App läuft (z. B. "/abc123"), "" im Wurzelverzeichnis.
// Der Server schreibt ihn als <base href> in index.html (BASE_PATH bzw. Pfad von PUBLIC_BASE_URL).

export function basePathFromHref(href) {
  if (!href) return "";
  try {
    return new URL(href, "http://localhost").pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function detectBasePath() {
  if (typeof document === "undefined") return "";
  return basePathFromHref(document.querySelector("base[href]")?.getAttribute("href"));
}

export const BASE_PATH = detectBasePath();

// Setzt den Unterpfad vor einen Pfad der App ("/api/v1/…"); volle URLs bleiben unverändert.
export function prefixPath(basePath, path) {
  if (!basePath || typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    return path;
  }
  return `${basePath}${path}`;
}

export function withBasePath(path) {
  return prefixPath(BASE_PATH, path);
}

// Speicher (localStorage/sessionStorage) gilt pro Domain, nicht pro Pfad:
// mehrere Instanzen unter einer Domain bekommen deshalb eigene Schlüssel.
export function scopedStorageKey(key) {
  return BASE_PATH ? `${key}:${BASE_PATH}` : key;
}

// Öffentliche Adresse dieser Instanz, wie sie im Browser erscheint
export function currentAppUrl() {
  return `${window.location.origin}${BASE_PATH}`;
}
