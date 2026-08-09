import { Router } from "express";

import { pool } from "../database/pool.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const mapRoutes = Router();

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
