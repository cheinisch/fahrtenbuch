FROM node:22-alpine

ARG APP_VERSION=unknown
ARG BUILD_NUMBER=0

LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL de.fahrtenbuch.build="${BUILD_NUMBER}"

WORKDIR /app
COPY VERSION BUILD ./
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
COPY backend ./backend

WORKDIR /app/backend
EXPOSE 3000
CMD ["npm", "start"]
