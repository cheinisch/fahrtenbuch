# Protomaps über eigenen Tileserver

Das Dashboard verwendet **MapLibre GL JS** als Renderer. Protomaps wird ausschließlich über einen eigenen Tileserver angebunden; eine direkte `.pmtiles`-URL wird nicht verwendet.

## Einstellungen

- Kartenanbieter: `Protomaps (eigener Tileserver)`
- Protomaps-Tileserver: vollständige HTTP(S)-URL zum **TileJSON-Endpunkt** des eigenen Servers, z. B. `http://172.16.2.20:8080/europe.json`
- Kartenstil: `Automatisch`, `Hell`, `Dunkel`, `Graustufen`, `Weiß` oder `Schwarz`
- Eigene Protomaps-Assets: optional

Der TileJSON-Endpunkt muss MapLibre-kompatible Vector-Tile-URLs liefern. Läuft der Tileserver auf einem anderen Host oder Port als das Fahrtenbuch, muss CORS für die Fahrtenbuch-Weboberfläche erlaubt sein.

## Assets

Ohne eigene Asset-URL werden Fonts und Sprites aus dem öffentlichen Protomaps-Basemap-Asset-Repository verwendet. Für vollständig selbst gehosteten Betrieb kann eine Basis-URL eingetragen werden, unter der diese Pfade verfügbar sind:

- `fonts/{fontstack}/{range}.pbf`
- `sprites/v4/<flavor>.json`
- `sprites/v4/<flavor>.png`

## Frontend-Abhängigkeiten

- `maplibre-gl` als Kartenrenderer
- `@protomaps/basemaps` für die Protomaps-Basemap-Layer und Styles

Die direkte `pmtiles`-Frontend-Abhängigkeit ist für diese Variante nicht erforderlich, weil der eigene Tileserver die PMTiles-Datei serverseitig bereitstellt.
