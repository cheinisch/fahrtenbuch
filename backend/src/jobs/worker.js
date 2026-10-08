import { pool } from "../database/pool.js";
import { resolveTripEndpointAddresses } from "../services/tripAddressService.js";
import { enqueueJob, reserveJob, acknowledgeJob, retryJob, failJob, recoverAndPromote, promoteDueJobs } from "./queue.js";
import { redisCommand } from "./redisClient.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const handlers = {
  "trip.reverseGeocode": async ({ tripId, userId }) => {
    await resolveTripEndpointAddresses(tripId, userId);
  },
  "trip.archivePurge": async () => {
    const result = await pool.query("DELETE FROM trips WHERE archived_at IS NOT NULL AND archived_at < now() - interval '90 days'");
    if (result.rowCount) console.info("Purged archived trips:", result.rowCount);
  },
};

async function backfillAddresses() {
  const rows = await pool.query(
    `SELECT t.id, t.user_id FROM trips t
     WHERE t.status='completed' AND t.archived_at IS NULL
       AND (NULLIF(t.start_address,'') IS NULL OR NULLIF(t.end_address,'') IS NULL)
       AND EXISTS (SELECT 1 FROM track_points p WHERE p.trip_id=t.id)
     ORDER BY t.started_at DESC LIMIT 500`,
  );
  for (const trip of rows.rows) {
    const key = "fahrtenbuch:jobs:geocode:" + trip.id;
    if (await redisCommand("SET", key, "1", "NX", "EX", 3600) === "OK") {
      await enqueueJob("trip.reverseGeocode", { tripId: trip.id, userId: trip.user_id });
    }
  }
}

let running = true;
process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

async function main() {
  await recoverAndPromote();
  let nextScan = 0;
  let nextPurge = 0;
  while (running) {
    try {
      await promoteDueJobs();
      if (Date.now() >= nextScan) {
        await backfillAddresses();
        nextScan = Date.now() + 15 * 60 * 1000;
      }
      if (Date.now() >= nextPurge) {
        await enqueueJob("trip.archivePurge", {});
        nextPurge = Date.now() + 24 * 60 * 60 * 1000;
      }
      const raw = await reserveJob();
      if (!raw) { await sleep(1500); continue; }
      const job = JSON.parse(raw);
      try {
        const handler = handlers[job.type];
        if (!handler) throw new Error("Unknown job type: " + job.type);
        await handler(job.payload);
        await acknowledgeJob(raw);
      } catch (error) {
        console.error("Job failed", job.type, error);
        if (job.attempt >= 4) await failJob(raw, error.message);
        else await retryJob(raw, Math.min(3600, 30 * 2 ** job.attempt));
      }
    } catch (error) {
      console.error("Worker loop error:", error);
      await sleep(5000);
    }
  }
  await pool.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
