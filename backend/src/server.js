import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./database/pool.js";
import { resolveTripEndpointAddresses } from "./services/tripAddressService.js";
import { runMigrations } from "./database/migrate.js";
import { seedDefaultAdmin } from "./database/seedDefaultAdmin.js";

let server;
let archiveCleanupTimer;

async function backfillTripAddresses() {
  try {
    const rows = await pool.query(
      `SELECT id, user_id FROM trips
       WHERE status='completed' AND archived_at IS NULL
         AND (NULLIF(start_address,'') IS NULL OR NULLIF(end_address,'') IS NULL)
         AND EXISTS (SELECT 1 FROM track_points WHERE trip_id=trips.id)
       ORDER BY started_at DESC LIMIT 20`,
    );
    for (const trip of rows.rows) {
      await resolveTripEndpointAddresses(trip.id, trip.user_id);
    }
  } catch (error) {
    console.warn("Trip address backfill failed:", error);
  }
}

async function purgeExpiredTrips() {
  try {
    const result = await pool.query("DELETE FROM trips WHERE archived_at IS NOT NULL AND archived_at < now() - interval '90 days'");
    if (result.rowCount) console.log(`Purged ${result.rowCount} expired archived trips`);
  } catch (error) {
    console.error("Trip archive cleanup failed:", error);
  }
}


async function startServer() {
  await runMigrations();
  await seedDefaultAdmin();
  await purgeExpiredTrips();
  void backfillTripAddresses();
  archiveCleanupTimer = setInterval(purgeExpiredTrips, 24 * 60 * 60 * 1000);
  archiveCleanupTimer.unref();

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

  if (archiveCleanupTimer) clearInterval(archiveCleanupTimer);
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
