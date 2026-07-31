import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "src/app.js",
  "src/server.js",
  "src/routes/authRoutes.js",
  "src/routes/userRoutes.js",
  "src/routes/vehicleRoutes.js",
  "src/routes/tripRoutes.js",
  "src/routes/trackingRoutes.js",
  "src/routes/tagRoutes.js",
  "src/routes/dashboardRoutes.js",
  "src/routes/statisticsRoutes.js",
  "src/routes/serviceRoutes.js",
  "src/routes/settingsRoutes.js",
  "src/routes/importExportRoutes.js",
  "src/routes/adminRoutes.js",
  "src/database/migrations/0001_initial.sql",
  "src/database/migrations/0002_complete_api.sql",
  "openapi.yml"
];

const missing = requiredFiles.filter(
  (relativePath) => !fs.existsSync(path.join(root, relativePath)),
);

if (missing.length > 0) {
  console.error("Fehlende API-Dateien:");
  for (const file of missing) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`API-Dateiprüfung erfolgreich: ${requiredFiles.length} Dateien vorhanden.`);
