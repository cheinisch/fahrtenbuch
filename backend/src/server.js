import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const port = Number(process.env.PORT || 3000);
const host = process.env.APP_HOST || "0.0.0.0";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

const frontendDirectory = path.resolve(
  currentDirectory,
  "../../frontend/dist",
);

app.use(express.json());

app.get("/api/v1/health", (request, response) => {
  response.status(200).json({
    status: "ok",
    service: "fahrtenbuch",
    timestamp: new Date().toISOString(),
  });
});

app.use(express.static(frontendDirectory));

app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) {
    return next();
  }

  response.sendFile(path.join(frontendDirectory, "index.html"));
});

app.use((request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Die angeforderte API-Route wurde nicht gefunden.",
    },
  });
});

app.listen(port, host, () => {
  console.log(`Fahrtenbuch läuft auf http://${host}:${port}`);
});