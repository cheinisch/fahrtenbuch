import { redisCommand } from "./redisClient.js";

const PREFIX = "fahrtenbuch:jobs";

export async function enqueueJob(type, payload, { delaySeconds = 0 } = {}) {
  const id = crypto.randomUUID();
  const job = JSON.stringify({ id, type, payload, attempt: 0 });
  if (delaySeconds > 0) {
    await redisCommand("ZADD", PREFIX + ":delayed", Math.floor(Date.now() / 1000) + delaySeconds, job);
  } else {
    await redisCommand("LPUSH", PREFIX + ":pending", job);
  }
  return id;
}

export async function reserveJob() {
  // RPOPLPUSH leaves jobs in the processing list until acknowledged.
  return redisCommand("RPOPLPUSH", PREFIX + ":pending", PREFIX + ":processing");
}

export async function acknowledgeJob(job) {
  await redisCommand("LREM", PREFIX + ":processing", 1, job);
}

export async function retryJob(job, delaySeconds) {
  const updated = JSON.stringify({ ...JSON.parse(job), attempt: JSON.parse(job).attempt + 1 });
  await redisCommand("ZADD", PREFIX + ":delayed", Math.floor(Date.now() / 1000) + delaySeconds, updated);
  await acknowledgeJob(job);
}

export async function failJob(job, message) {
  await redisCommand("LPUSH", PREFIX + ":failed", JSON.stringify({ ...JSON.parse(job), error: message, failedAt: new Date().toISOString() }));
  await acknowledgeJob(job);
}

export async function recoverAndPromote() {
  const processing = await redisCommand("LRANGE", PREFIX + ":processing", 0, -1);
  for (const job of processing || []) {
    await redisCommand("LPUSH", PREFIX + ":pending", job);
    await redisCommand("LREM", PREFIX + ":processing", 1, job);
  }
}

export async function promoteDueJobs() {
  const due = await redisCommand("ZRANGEBYSCORE", PREFIX + ":delayed", "-inf", Math.floor(Date.now() / 1000), "LIMIT", 0, 50);
  for (const job of due || []) {
    if (await redisCommand("ZREM", PREFIX + ":delayed", job)) await redisCommand("LPUSH", PREFIX + ":pending", job);
  }
}
