import "dotenv/config";

import compression from "compression";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "./database/migrate.js";
import { pool } from "./database/pool.js";
import { seedDefaultAdmin } from "./database/seedDefaultAdmin.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

const frontendDirectory = path.resolve(
  currentDirectory,
  "../../frontend/dist",
);

const app = express();

const port = Number(process.env.PORT || 3000);
const host = process.env.APP_HOST || "0.0.0.0";

app.disable("x-powered-by");

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(compression());
app.use(morgan("combined"));
app.use(express.json({ limit: "1mb" }));

app.get("/api/v1/health", (request, response) => {
  response.json({
    status: "ok",
    service: "fahrtenbuch",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);

app.use("/api", (request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Die angeforderte API-Route wurde nicht gefunden.",
    },
  });
});

app.use(express.static(frontendDirectory));

app.use((request, response, next) => {
  response.sendFile(
    path.join(frontendDirectory, "index.html"),
    (error) => {
      if (error) {
        next(error);
      }
    },
  );
});

app.use((error, request, response, next) => {
  console.error(error);

  if (response.headersSent) {
    return next(error);
  }

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Es ist ein interner Fehler aufgetreten.",
    },
  });
});

async function startServer() {
  await runMigrations();
  await seedDefaultAdmin();

  app.listen(port, host, () => {
    console.log(`Fahrtenbuch läuft auf http://${host}:${port}`);
  });
}

startServer().catch(async (error) => {
  console.error("Fahrtenbuch konnte nicht gestartet werden:", error);
  await pool.end();
  process.exit(1);
});