import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";

import { pool } from "../database/pool.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const mapRoutes = Router();

const OSM_TILE_CACHE_DIR =
  process.env.OSM_TILE_CACHE_DIR ||
  "/data/osm-tile-cache";
const OSM_TILE_CACHE_MAX_BYTES = Number(
  process.env.OSM_TILE_CACHE_MAX_BYTES ||
    10 * 1024 * 1024 * 1024,
);
const OSM_MIN_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
let osmCacheBytes = null;
let osmCleanupPromise = null;

function parseMaxAge(value) {
  const match = String(value || "").match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Number(match[1]) * 1000 : null;
}

async function walkFiles(directory, result = []) {
  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return result;
    }
    throw error;
  }

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolute, result);
    } else if (entry.isFile() && entry.name.endsWith(".png")) {
      const stat = await fs.stat(absolute);
      result.push({ path: absolute, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }

  return result;
}

async function initializeOsmCacheSize() {
  if (osmCacheBytes !== null) {
    return osmCacheBytes;
  }

  await fs.mkdir(OSM_TILE_CACHE_DIR, { recursive: true });
  const files = await walkFiles(OSM_TILE_CACHE_DIR);
  osmCacheBytes = files.reduce((sum, file) => sum + file.size, 0);
  return osmCacheBytes;
}

async function enforceOsmCacheLimit() {
  if (osmCleanupPromise) {
    return osmCleanupPromise;
  }

  osmCleanupPromise = (async () => {
    await initializeOsmCacheSize();

    if (osmCacheBytes <= OSM_TILE_CACHE_MAX_BYTES) {
      return;
    }

    const files = await walkFiles(OSM_TILE_CACHE_DIR);
    files.sort((left, right) => left.mtimeMs - right.mtimeMs);

    for (const file of files) {
      if (osmCacheBytes <= OSM_TILE_CACHE_MAX_BYTES) {
        break;
      }

      await fs.rm(file.path, { force: true });
      await fs.rm(`${file.path}.json`, { force: true });
      osmCacheBytes = Math.max(0, osmCacheBytes - file.size);
    }
  })().finally(() => {
    osmCleanupPromise = null;
  });

  return osmCleanupPromise;
}

function osmCachePaths(z, x, y) {
  const tilePath = path.join(
    OSM_TILE_CACHE_DIR,
    String(z),
    String(x),
    `${y}.png`,
  );

  return {
    tilePath,
    metadataPath: `${tilePath}.json`,
  };
}

async function readOsmMetadata(metadataPath) {
  try {
    return JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

function osmUserAgent() {
  const publicUrl = String(process.env.PUBLIC_BASE_URL || "").trim();
  return publicUrl
    ? `Fahrtenbuch/1.0 (+${publicUrl})`
    : "Fahrtenbuch/1.0";
}

async function serveCachedOsmTile(response, tilePath, metadata) {
  const body = await fs.readFile(tilePath);
  response.setHeader("Content-Type", "image/png");
  response.setHeader(
    "Cache-Control",
    metadata?.cacheControl || "public, max-age=604800",
  );
  if (metadata?.etag) response.setHeader("ETag", metadata.etag);
  if (metadata?.lastModified) {
    response.setHeader("Last-Modified", metadata.lastModified);
  }
  response.setHeader("X-Fahrtenbuch-Tile-Cache", "HIT");
  response.send(body);
  fs.utimes(tilePath, new Date(), new Date()).catch(() => {});
}

mapRoutes.get(
  "/osm/:z/:x/:y.png",
  asyncHandler(async (request, response) => {
    const z = Number(request.params.z);
    const x = Number(request.params.x);
    const y = Number(request.params.y);

    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 0 ||
      z > 19 ||
      x < 0 ||
      y < 0
    ) {
      return response.status(400).json({
        error: "INVALID_TILE",
        message: "Ungültige OSM-Tile-Koordinaten.",
      });
    }

    const { tilePath, metadataPath } = osmCachePaths(z, x, y);
    const metadata = await readOsmMetadata(metadataPath);
    const now = Date.now();

    try {
      await fs.access(tilePath);
      if (metadata?.expiresAt && Number(metadata.expiresAt) > now) {
        return serveCachedOsmTile(response, tilePath, metadata);
      }
    } catch {
      // Cache miss.
    }

    const upstreamHeaders = {
      Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
      "User-Agent": osmUserAgent(),
    };

    const referer =
      request.get("referer") ||
      String(process.env.PUBLIC_BASE_URL || "").trim();
    if (referer) upstreamHeaders.Referer = referer;
    if (metadata?.etag) upstreamHeaders["If-None-Match"] = metadata.etag;
    if (metadata?.lastModified) {
      upstreamHeaders["If-Modified-Since"] = metadata.lastModified;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let upstream;

    try {
      upstream = await fetch(
        `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        {
          signal: controller.signal,
          headers: upstreamHeaders,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (upstream.status === 304) {
      const stat = await fs.stat(tilePath);
      const cacheControl =
        upstream.headers.get("cache-control") ||
        metadata?.cacheControl ||
        "public, max-age=604800";
      const ttlMs = Math.max(
        parseMaxAge(cacheControl) || 0,
        OSM_MIN_CACHE_MS,
      );
      const refreshed = {
        ...metadata,
        cacheControl,
        expiresAt: now + ttlMs,
      };
      await fs.writeFile(metadataPath, JSON.stringify(refreshed));
      await fs.utimes(tilePath, new Date(), new Date());
      osmCacheBytes = osmCacheBytes ?? stat.size;
      return serveCachedOsmTile(response, tilePath, refreshed);
    }

    if (!upstream.ok) {
      const cachedExists = await fs.access(tilePath).then(() => true).catch(() => false);
      if (cachedExists) {
        response.setHeader("Warning", '110 - "Response is stale"');
        return serveCachedOsmTile(response, tilePath, metadata);
      }

      return response.status(upstream.status).json({
        error: "OSM_TILE_UPSTREAM_ERROR",
        message: `OpenStreetMap antwortete mit HTTP ${upstream.status}.`,
      });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    const cacheControl =
      upstream.headers.get("cache-control") ||
      "public, max-age=604800";
    const ttlMs = Math.max(
      parseMaxAge(cacheControl) || 0,
      OSM_MIN_CACHE_MS,
    );
    const nextMetadata = {
      cacheControl,
      etag: upstream.headers.get("etag") || null,
      lastModified: upstream.headers.get("last-modified") || null,
      expiresAt: now + ttlMs,
      storedAt: now,
    };

    await fs.mkdir(path.dirname(tilePath), { recursive: true });
    const previousSize = await fs.stat(tilePath).then((stat) => stat.size).catch(() => 0);
    await fs.writeFile(tilePath, body);
    await fs.writeFile(metadataPath, JSON.stringify(nextMetadata));
    await initializeOsmCacheSize();
    osmCacheBytes += body.length - previousSize;
    enforceOsmCacheLimit().catch((error) => {
      console.error("OSM-Tile-Cache konnte nicht bereinigt werden:", error);
    });

    response.setHeader("Content-Type", "image/png");
    response.setHeader("Cache-Control", cacheControl);
    if (nextMetadata.etag) response.setHeader("ETag", nextMetadata.etag);
    if (nextMetadata.lastModified) {
      response.setHeader("Last-Modified", nextMetadata.lastModified);
    }
    response.setHeader("X-Fahrtenbuch-Tile-Cache", "MISS");
    response.send(body);
  }),
);

const TILEJSON_CACHE_MS = 60_000;
let tileJsonCache = null;

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function getMapDefaults() {
  const result = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'map.defaults' LIMIT 1`,
  );

  return {
    provider: "osm",
    protomapsTileServerUrl: "",
    protomapsAssetsUrl: "",
    ...(result.rows[0]?.value || {}),
  };
}

function assertHttpUrl(value, label) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} ist keine gültige URL.`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} muss HTTP oder HTTPS verwenden.`);
  }

  return url;
}

async function fetchChecked(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Fahrtenbuch-MapProxy/1.0",
        Accept: "*/*",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Tileserver antwortete mit HTTP ${response.status} ${response.statusText}`,
      );
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOriginalTileJson(force = false) {
  const settings = await getMapDefaults();
  const configured = normalizeBaseUrl(settings.protomapsTileServerUrl);

  if (!configured) {
    throw new Error(
      "In den Admin-Einstellungen ist kein Protomaps-Tileserver konfiguriert.",
    );
  }

  const tileJsonUrl = /\.json(?:[?#].*)?$/i.test(configured)
    ? configured
    : `${configured}/europe.json`;

  const now = Date.now();

  if (
    !force &&
    tileJsonCache &&
    tileJsonCache.url === tileJsonUrl &&
    now - tileJsonCache.loadedAt < TILEJSON_CACHE_MS
  ) {
    return {
      settings,
      tileJsonUrl,
      tileJson: tileJsonCache.tileJson,
    };
  }

  assertHttpUrl(tileJsonUrl, "Protomaps-TileJSON-URL");
  const response = await fetchChecked(tileJsonUrl, {
    headers: {
      Accept: "application/json",
    },
  });
  const tileJson = await response.json();

  if (
    !tileJson ||
    typeof tileJson !== "object" ||
    !Array.isArray(tileJson.tiles) ||
    tileJson.tiles.length === 0
  ) {
    throw new Error(
      "Der Protomaps-Tileserver liefert kein gültiges TileJSON mit mindestens einer Tile-URL.",
    );
  }

  tileJsonCache = {
    url: tileJsonUrl,
    tileJson,
    loadedAt: now,
  };

  return {
    settings,
    tileJsonUrl,
    tileJson,
  };
}

function resolveTemplate(template, z, x, y) {
  return String(template)
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y));
}

function copyProxyHeaders(source, target, fallbackType) {
  target.setHeader(
    "Content-Type",
    source.headers.get("content-type") || fallbackType,
  );
  target.setHeader(
    "Cache-Control",
    source.headers.get("cache-control") || "public, max-age=3600",
  );

  const etag = source.headers.get("etag");
  if (etag) {
    target.setHeader("ETag", etag);
  }
}

mapRoutes.get(
  "/protomaps/tilejson",
  asyncHandler(async (_request, response) => {
    const { tileJson } = await loadOriginalTileJson();

    response.setHeader("Cache-Control", "no-cache");

    response.json({
      ...tileJson,
      tiles: tileJson.tiles.map(
        (_template, index) =>
          `/api/v1/map/protomaps/tiles/${index}/{z}/{x}/{y}`,
      ),
    });
  }),
);

mapRoutes.get(
  "/protomaps/tiles/:templateIndex/:z/:x/:y",
  asyncHandler(async (request, response) => {
    const templateIndex = Number(request.params.templateIndex);
    const z = Number(request.params.z);
    const x = Number(request.params.x);
    const y = Number(request.params.y);

    if (
      !Number.isInteger(templateIndex) ||
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      templateIndex < 0 ||
      z < 0 ||
      x < 0 ||
      y < 0
    ) {
      return response.status(400).json({
        error: "INVALID_TILE",
        message: "Ungültige Tile-Koordinaten.",
      });
    }

    const { tileJson } = await loadOriginalTileJson();
    const template = tileJson.tiles[templateIndex];

    if (!template) {
      return response.status(404).json({
        error: "TILE_TEMPLATE_NOT_FOUND",
        message: "Die Tile-Vorlage wurde nicht gefunden.",
      });
    }

    const upstreamUrl = resolveTemplate(template, z, x, y);
    assertHttpUrl(upstreamUrl, "Vector-Tile-URL");

    const upstream = await fetchChecked(upstreamUrl, {
      headers: {
        Accept:
          "application/vnd.mapbox-vector-tile, application/x-protobuf, application/octet-stream, */*",
      },
    });

    copyProxyHeaders(
      upstream,
      response,
      "application/vnd.mapbox-vector-tile",
    );

    response.send(Buffer.from(await upstream.arrayBuffer()));
  }),
);

async function proxyAsset(response, relativePath, fallbackType) {
  const settings = await getMapDefaults();
  const configuredAssets = normalizeBaseUrl(
    settings.protomapsAssetsUrl,
  );
  const assetsBase =
    configuredAssets ||
    "https://protomaps.github.io/basemaps-assets";

  const upstreamUrl = `${assetsBase}/${relativePath}`;
  assertHttpUrl(upstreamUrl, "Protomaps-Asset-URL");

  const upstream = await fetchChecked(upstreamUrl);
  copyProxyHeaders(upstream, response, fallbackType);
  response.send(Buffer.from(await upstream.arrayBuffer()));
}

mapRoutes.get(
  "/protomaps/fonts/:fontstack/:range",
  asyncHandler(async (request, response) => {
    const fontstack = encodeURIComponent(
      String(request.params.fontstack || ""),
    );
    const range = String(request.params.range || "");

    if (!/^\d+-\d+\.pbf$/i.test(range)) {
      return response.status(400).end();
    }

    await proxyAsset(
      response,
      `fonts/${fontstack}/${range}`,
      "application/x-protobuf",
    );
  }),
);

mapRoutes.get(
  "/protomaps/sprites/v4/:file",
  asyncHandler(async (request, response) => {
    const file = String(request.params.file || "");

    if (
      !/^[a-z0-9_-]+(?:@2x)?\.(?:json|png)$/i.test(file)
    ) {
      return response.status(400).end();
    }

    await proxyAsset(
      response,
      `sprites/v4/${file}`,
      file.endsWith(".json")
        ? "application/json"
        : "image/png",
    );
  }),
);
