import pg from "pg";

import { config } from "../config.js";

const { Pool, types } = pg;

// bigint/NUMERIC werden als Number zurückgegeben. Für Fahrtenbuchwerte bleibt
// der Wertebereich in der Praxis deutlich unter Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error("Unerwarteter PostgreSQL-Poolfehler:", error);
});
