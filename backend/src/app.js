import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";

import { config } from "./config.js";
import { adminRoutes } from "./routes/adminRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { dashboardRoutes } from "./routes/dashboardRoutes.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import {
  exportRoutes,
  importRoutes,
} from "./routes/importExportRoutes.js";
import {
  configRoutes,
  geocodingRoutes,
} from "./routes/serviceRoutes.js";
import { settingsRoutes } from "./routes/settingsRoutes.js";
import { statisticsRoutes } from "./routes/statisticsRoutes.js";
import { tagRoutes } from "./routes/tagRoutes.js";
import { trackingRoutes } from "./routes/trackingRoutes.js";
import { tripRoutes } from "./routes/tripRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { vehicleRoutes } from "./routes/vehicleRoutes.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.js";
import { requestContext } from "./middleware/requestContext.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(currentDirectory, "..");

export const app = express();

app.disable("x-powered-by");

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(requestContext);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://www.gravatar.com",
          "https://secure.gravatar.com",
          "https://*.gravatar.com",
          "https://tile.openstreetmap.org",
        ],
        connectSrc: [
          "'self'",
          "https://tile.openstreetmap.org",
        ],
        workerSrc: ["'self'", "blob:"],
        childSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  }),
);
app.use(compression());
app.use(morgan(config.env === "production" ? "combined" : "dev"));

if (process.env.CORS_ORIGIN) {
  app.use((request, response, next) => {
    const origin = request.get("origin");
    const allowedOrigins = process.env.CORS_ORIGIN.split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (origin && allowedOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Request-ID",
      );
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      );
    }

    if (request.method === "OPTIONS") {
      return response.status(204).end();
    }

    next();
  });
}

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "RATE_LIMITED",
    message: "Zu viele Authentifizierungsversuche. Bitte versuche es später erneut.",
    details: null,
    requestId: null,
  },
});

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/vehicles", vehicleRoutes);
app.use("/api/v1/trips", tripRoutes);
app.use("/api/v1/tracking", trackingRoutes);
app.use("/api/v1/tags", tagRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/statistics", statisticsRoutes);
app.use("/api/v1/config", configRoutes);
app.use("/api/v1/geocoding", geocodingRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/export", exportRoutes);
app.use("/api/v1/import", importRoutes);
app.use("/api/v1/admin", adminRoutes);

const openApiCandidates = [
  path.resolve(backendDirectory, "openapi.yml"),
  "/app/api/openapi.yml",
  path.resolve(backendDirectory, "../api/openapi.yml"),
];
const openApiPath = openApiCandidates.find((candidate) => fs.existsSync(candidate));

if (openApiPath) {
  app.get("/api/v1/openapi.yml", (_request, response) => {
    response.type("application/yaml").sendFile(openApiPath);
  });
}

app.use("/api/v1", notFoundHandler);

if (fs.existsSync(config.staticDirectory)) {
  app.use(
    express.static(config.staticDirectory, {
      index: false,
      etag: true,
      maxAge: config.env === "production" ? "1h" : 0,
      setHeaders(response, filePath) {
        if (filePath.endsWith("index.html")) {
          response.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.get("/{*splat}", (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(path.join(config.staticDirectory, "index.html"));
  });
} else {
  app.get("/", (_request, response) => {
    response.json({
      application: "Fahrtenbuch",
      version: config.version,
      api: "/api/v1",
      openapi: openApiPath ? "/api/v1/openapi.yml" : null,
    });
  });
}

app.use(errorHandler);
