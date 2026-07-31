import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(backendRoot, "src");
const routesRoot = path.join(sourceRoot, "routes");
const appPath = path.join(sourceRoot, "app.js");
const openApiPath = path.join(backendRoot, "openapi.yml");
const httpMethods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]);

function normalizePath(value) {
  let result = String(value || "").trim();

  if (result.startsWith("/api/v1")) {
    result = result.slice("/api/v1".length) || "/";
  }

  result = result.replace(/:([A-Za-z_]\w*)/g, "{$1}");
  result = result.replace(/\/{2,}/g, "/");

  if (!result.startsWith("/")) {
    result = `/${result}`;
  }

  if (result.length > 1) {
    result = result.replace(/\/+$/, "");
  }

  return result;
}

function operationKey(method, routePath) {
  return `${method.toUpperCase()} ${normalizePath(routePath)}`;
}

function readBalancedCalls(source, marker) {
  const calls = [];
  let searchPosition = 0;

  while (searchPosition < source.length) {
    const markerPosition = source.indexOf(marker, searchPosition);

    if (markerPosition < 0) {
      break;
    }

    const contentStart = markerPosition + marker.length;
    let depth = 1;
    let quote = null;
    let escaped = false;
    let position = contentStart;

    while (position < source.length && depth > 0) {
      const character = source[position];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
      } else if (["'", '"', "`"].includes(character)) {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
      }

      position += 1;
    }

    if (depth !== 0) {
      throw new Error(`Nicht geschlossener Aufruf nach ${marker}.`);
    }

    calls.push(source.slice(contentStart, position - 1));
    searchPosition = position;
  }

  return calls;
}

function readOpenApiOperations() {
  const source = fs.readFileSync(openApiPath, "utf8");
  const operations = new Set();
  let currentPath = null;

  for (const line of source.split(/\r?\n/)) {
    const pathMatch = /^  (\/[^:]+):\s*$/.exec(line);

    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = /^    ([a-z]+):\s*$/.exec(line);

    if (
      currentPath &&
      methodMatch &&
      httpMethods.has(methodMatch[1])
    ) {
      operations.add(
        operationKey(methodMatch[1], currentPath),
      );
    }
  }

  return operations;
}

function readRouterMounts() {
  const source = fs.readFileSync(appPath, "utf8");
  const mounts = new Map();

  for (const call of readBalancedCalls(source, "app.use(")) {
    const prefixMatch = /^\s*["']([^"']+)["']\s*,/.exec(call);

    if (!prefixMatch) {
      continue;
    }

    const routerMatches = [
      ...call.matchAll(/\b([A-Za-z_]\w*Routes)\b/g),
    ];

    if (routerMatches.length === 0) {
      continue;
    }

    const routerName =
      routerMatches[routerMatches.length - 1][1];

    mounts.set(routerName, prefixMatch[1]);
  }

  return mounts;
}

function readImplementedOperations() {
  const mounts = readRouterMounts();
  const operations = new Set();
  const routePattern =
    /\b([A-Za-z_]\w*Routes)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']*)["']/gs;

  for (const fileName of fs.readdirSync(routesRoot)) {
    if (!fileName.endsWith(".js")) {
      continue;
    }

    const source = fs.readFileSync(
      path.join(routesRoot, fileName),
      "utf8",
    );

    for (const match of source.matchAll(routePattern)) {
      const [, routerName, method, routerPath] = match;
      const mountPath = mounts.get(routerName);

      if (!mountPath) {
        continue;
      }

      const fullPath = `${mountPath.replace(/\/$/, "")}/${routerPath.replace(
        /^\//,
        "",
      )}`;

      operations.add(operationKey(method, fullPath));
    }
  }

  return operations;
}

const documented = readOpenApiOperations();
const implemented = readImplementedOperations();
const missing = [...documented]
  .filter((operation) => !implemented.has(operation))
  .sort();
const additional = [...implemented]
  .filter((operation) => !documented.has(operation))
  .sort();

if (missing.length > 0) {
  console.error(
    `OpenAPI-Abdeckung fehlgeschlagen: ${missing.length} Endpunkte fehlen.`,
  );

  for (const operation of missing) {
    console.error(`- ${operation}`);
  }

  process.exit(1);
}

console.log(
  `OpenAPI-Abdeckung erfolgreich: ${documented.size}/${documented.size} dokumentierte Endpunkte implementiert.`,
);

if (additional.length > 0) {
  console.log(
    `${additional.length} zusätzliche kompatible Web-Endpunkte sind vorhanden:`,
  );

  for (const operation of additional) {
    console.log(`- ${operation}`);
  }
}
