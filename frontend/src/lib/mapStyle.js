import { layers, namedFlavor } from "@protomaps/basemaps";

import { translate } from "../i18n/translate.js";

// Kartenstil aus den Kartenvorgaben des Servers (OSM-Raster oder Protomaps-Vektor);
// gemeinsam genutzt von Dashboard und Fahrtseite.
export const OSM_MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "/api/v1/map/osm/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: `© ${translate("dashboard.osmContributors")}`,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

function resolveProtomapsFlavor(value) {
  if (value && value !== "auto") {
    return value;
  }

  // Kontoeinstellung (data-theme) vor der Systemeinstellung berücksichtigen.
  const forcedTheme = document.documentElement.dataset.theme;
  if (forcedTheme === "dark" || forcedTheme === "light") {
    return forcedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// OpenFreeMap-Stile wie in der Android-App (hell: Positron, dunkel: Dark)
export const OPENFREEMAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

/** Persönlicher Kartenstil (osm | light | dark | auto) → light/dark oder null (Servervorgabe). */
export function resolveUserMapStyle(mapStyle) {
  if (mapStyle === "light" || mapStyle === "dark") return mapStyle;
  if (mapStyle === "auto") return resolveProtomapsFlavor("auto");
  return null;
}

/**
 * Kartenstil: der persönliche Stil hat Vorrang (OpenFreeMap hell/dunkel bzw. passend zum
 * Farbschema), sonst die Kartenvorgabe des Servers (OSM-Raster oder Protomaps).
 */
export function createMapStyle(settings, mapStyle = "osm") {
  const personal = resolveUserMapStyle(mapStyle);
  if (personal) return OPENFREEMAP_STYLES[personal];
  if (settings?.provider !== "protomaps") {
    return OSM_MAP_STYLE;
  }

  const flavorName = resolveProtomapsFlavor(
    settings.protomapsFlavor,
  );

  return {
    version: 8,
    glyphs:
      "/api/v1/map/protomaps/fonts/{fontstack}/{range}.pbf",
    sprite:
      `/api/v1/map/protomaps/sprites/v4/${flavorName}`,
    sources: {
      protomaps: {
        type: "vector",
        url: "/api/v1/map/protomaps/tilejson",
        attribution:
          `Protomaps © ${translate("dashboard.osmContributors")}`,
      },
    },
    layers: layers(
      "protomaps",
      namedFlavor(flavorName),
      // Beschriftungssprache der Karte folgt der Oberflächensprache (vom I18nProvider in <html lang> gesetzt).
      { lang: document.documentElement.lang || "de" },
    ),
  };
}
