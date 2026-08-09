# ------------------------------------------------------------
# Build Stage
# ------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Package-Dateien zuerst kopieren (Docker Cache)
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY shared/package*.json ./shared/

# Abhängigkeiten installieren
RUN npm ci

# Rest des Projekts kopieren
COPY . .

# Shared (falls vorhanden)
RUN npm run build --workspace shared --if-present

# Frontend bauen
RUN npm run build --workspace frontend

# DevDependencies entfernen
RUN npm prune --omit=dev


# ------------------------------------------------------------
# Runtime Stage
# ------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Dateien übernehmen
COPY --from=builder /app .

# Upload-Verzeichnis
RUN mkdir -p /data/uploads /data/backups /data/osm-tile-cache \
    && chown -R node:node /data

# Nicht als root laufen
USER node

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "backend"]