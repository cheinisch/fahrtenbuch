import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./database/pool.js";
import { runMigrations } from "./database/migrate.js";
import { seedDefaultAdmin } from "./database/seedDefaultAdmin.js";

let server;

async function startServer() {
  await runMigrations();
  await seedDefaultAdmin();

  server = app.listen(config.port, "0.0.0.0", () => {
    console.log(
      `Fahrtenbuch ${config.version} läuft auf http://0.0.0.0:${config.port}`,
    );
  });
}

async function shutdown(signal) {
  console.log(`${signal} empfangen. Fahrtenbuch wird beendet …`);

  const forceExit = setTimeout(() => {
    console.error("Beenden dauerte zu lange. Prozess wird abgebrochen.");
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await pool.end();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer().catch(async (error) => {
  console.error("Fahrtenbuch konnte nicht gestartet werden:", error);
  await pool.end().catch(() => {});
  process.exit(1);
});
