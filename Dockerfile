# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend-dependencies
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm install --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
RUN apk add --no-cache tini
COPY --from=backend-dependencies /build/backend/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/src ./src
COPY db ./db
COPY VERSION BUILD ./
COPY --from=frontend-build /build/frontend/dist ./public
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
