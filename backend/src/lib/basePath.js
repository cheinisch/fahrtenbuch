// Betrieb unter einem Unterpfad (z. B. https://demo.fahrtenbuch.app/abc123).
// Der Unterpfad wird als "/abc123" geführt, "" bedeutet Betrieb im Wurzelverzeichnis.

const SAFE_PATH = /^(\/[A-Za-z0-9._~-]+)+$/;

export function normalizeBasePath(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  // Nur harmlose Zeichen: der Wert landet ungeescaped in HTML und Cookie-Pfaden
  if (!SAFE_PATH.test(withSlash)) {
    throw new Error(`BASE_PATH "${value}" ist ungültig (erlaubt: A-Z, a-z, 0-9, . _ ~ - und /).`);
  }
  return withSlash;
}

// BASE_PATH hat Vorrang, sonst gilt der Pfad aus PUBLIC_BASE_URL.
export function resolveBasePath(explicitValue, publicBaseUrl) {
  if (explicitValue !== undefined && explicitValue !== null && String(explicitValue).trim() !== "") {
    return normalizeBasePath(explicitValue);
  }
  try {
    return normalizeBasePath(new URL(publicBaseUrl).pathname);
  } catch {
    return "";
  }
}

// Entfernt den Unterpfad vom Request, falls der Reverse-Proxy ihn nicht schon abgeschnitten hat.
// So funktioniert beides: Proxy mit und ohne StripPrefix.
export function stripBasePath(basePath) {
  return (request, _response, next) => {
    if (basePath) {
      const url = request.url;
      if (url === basePath || url.startsWith(`${basePath}/`) || url.startsWith(`${basePath}?`)) {
        const rest = url.slice(basePath.length);
        request.url = rest.startsWith("/") ? rest : `/${rest}`;
      }
    }
    next();
  };
}

// <base href> in index.html: das Frontend liest daraus den Unterpfad, relative Assets lösen sich darüber auf.
export function injectBaseHref(html, basePath) {
  const tag = `<base href="${basePath}/" />`;
  if (/<base\s/i.test(html)) {
    return html.replace(/<base\s[^>]*>/i, tag);
  }
  return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${tag}`);
}

// Demo-Betrieb: Statusadresse des Demo-Spawners (verbleibende Zeit, Verlängerung) als Meta-Tag,
// damit das Frontend schon vor dem Login einen Countdown zeigen kann.
const SAFE_URL_PATH = /^\/[A-Za-z0-9._~\/-]*$/;

export function normalizeDemoStatusUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (!SAFE_URL_PATH.test(trimmed)) {
    throw new Error(`DEMO_STATUS_URL "${value}" ist ungültig (nur ein Pfad wie /api/session/abc).`);
  }
  return trimmed;
}

export function injectDemoMeta(html, statusUrl) {
  if (!statusUrl) return html;
  return html.replace(/<head([^>]*)>/i, `<head$1>\n    <meta name="fahrtenbuch-demo" content="${statusUrl}" />`);
}
