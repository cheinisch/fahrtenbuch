// Standardfarben je Fahrtkategorie (Karte, Listenpunkte, Legende). Eigene Farben
// aus den persönlichen Einstellungen (mapRouteColors) haben Vorrang.
// Blau/Orange/Violett sind auch bei Farbfehlsichtigkeit unterscheidbar.
export const DEFAULT_ROUTE_COLORS = {
  business: "#0284c7",
  private: "#ea580c",
  commute: "#7c3aed",
  unclassified: "#8a8a8a",
};

export function routeColor(type, customColors = {}) {
  return customColors?.[type] || DEFAULT_ROUTE_COLORS[type] || DEFAULT_ROUTE_COLORS.unclassified;
}
