import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { Queue } from "bullmq";
import { env } from "./config.js";
import { transaction, rows, pool } from "./database.js";
import { isUuid } from "./foundation.js";
import { reject } from "./error.js";
export const queueConnection = {
  host: env("REDIS_HOST"),
  port: Number(env("REDIS_PORT")),
  password: env("REDIS_PASSWORD"),
  maxRetriesPerRequest: null,
};
const fields: Record<string, string[]> = {
  "m05.message.campaign.requested.v1": ["campaignId", "campaignVersion"],
  "media.validate.requested.v1": ["assetId"],
  "nutrition.recognition.requested.v1": ["jobId", "userId", "assetId"],
  "companion.reply.requested.v1": ["assistantMessageId", "sessionId", "userId"],
  "training.reminder.due.v1": [
    "reminderId",
    "userId",
    "reminderVersion",
    "scheduledAt",
  ],
  "activity.booking.confirmed.v1": [
    "bookingId",
    "bookingEventId",
    "slotId",
    "userId",
  ],
  "activity.booking.canceled.v1": [
    "bookingId",
    "bookingEventId",
    "slotId",
    "userId",
  ],
  "activity.slot.canceled.v1": ["slotId", "slotVersion", "actorUserId"],
  "points.redemption.requested.v1": ["redemptionId", "userId"],
  "points.redemption.finished.v1": [
    "redemptionId",
    "userId",
    "redemptionVersion",
    "status",
  ],
};
export function queueName(type: string) {
  return "qy-" + env("DB_NAME") + "-" + type.replaceAll(".", "-");
}
export async function enqueue(c: PoolConnection, event: any) {
  const allowed = fields[event.eventType];
  if (
    !allowed ||
    event.schemaVersion !== 1 ||
    !isUuid(event.aggregateId) ||
    !event.eventKey.startsWith(event.eventType + ":") ||
    Object.keys(event.payload).length !== allowed.length ||
    allowed.some((k) => event.payload[k] === undefined)
  )
    reject(422, "INVALID_EVENT", "事件字段未注册");
  for (const k of allowed) {
    const v = event.payload[k];
    if (
      (k.endsWith("Id") && !isUuid(v)) ||
      (k.endsWith("Version") && (!Number.isInteger(v) || v < 1)) ||
      (k === "scheduledAt" &&
        (typeof v !== "string" ||
          !/^\d{4}-.*Z$/.test(v) ||
          !Number.isFinite(Date.parse(v)))) ||
      (k === "status" && !["fulfilled", "refunded"].includes(v))
    )
      reject(422, "INVALID_EVENT", "事件字段无效");
  }
  await c.execute(
    "INSERT INTO outbox_events(id,event_type,aggregate_type,aggregate_id,event_key,schema_version,payload)VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",
    [
      randomUUID(),
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      event.eventKey,
      1,
      JSON.stringify(event.payload),
    ],
  );
}
export type DirectOutboxLease = {
  id: string;
  event_type: string;
  aggregate_id: string;
  event_key: string;
  payload: Record<string, unknown>;
  locked_by: string;
  lease_version: number;
};
const directConsumers = new Map<
  string,
  (lease: DirectOutboxLease) => Promise<unknown>
>();
const directTypes = new Set([
  "activity.booking.confirmed.v1",
  "activity.booking.canceled.v1",
  "activity.slot.canceled.v1",
  "points.redemption.requested.v1",
  "points.redemption.finished.v1",
  "m05.message.campaign.requested.v1",
]);
/** One dispatcher owns all event claims; registered M05 handlers receive its fenced lease. */
export function registerDirectOutboxConsumer(
  type: string,
  consume: (lease: DirectOutboxLease) => Promise<unknown>,
) {
  if (!directTypes.has(type) || directConsumers.has(type))
    throw Error("OUTBOX_CONSUMER_CONFLICT");
  directConsumers.set(type, consume);
  return () => {
    if (directConsumers.get(type) === consume) directConsumers.delete(type);
  };
}
export async function dispatchOnce() {
  const owner = randomUUID();
  const job: any = await transaction(async (c) => {
    const r = (
      await rows(
        c,
        "SELECT * FROM outbox_events WHERE (status='pending' AND next_attempt_at<=UTC_TIMESTAMP(3)) OR (status='processing' AND locked_until<UTC_TIMESTAMP(3)) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      )
    )[0];
    if (!r) return null;
    await c.execute(
      "UPDATE outbox_events SET status='processing',locked_by=?,locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),lease_version=lease_version+1,attempts=attempts+1 WHERE id=?",
      [owner, r.id],
    );
    return {
      ...r,
      locked_by: owner,
      lease_version: Number(r.lease_version) + 1,
      attempts: r.attempts + 1,
    };
  });
  if (!job) return;
  if (directTypes.has(job.event_type)) {
    try {
      const consume = directConsumers.get(job.event_type);
      if (!consume) throw Error("M05_CONSUMER_NOT_REGISTERED");
      await consume(job);
    } catch {
      await pool.execute(
        "UPDATE outbox_events SET status='pending',next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),last_error_code='M05_CONSUMER_RETRY',locked_by=NULL,locked_until=NULL WHERE id=? AND status='processing' AND locked_by=? AND lease_version=?",
        [job.id, job.locked_by, job.lease_version],
      );
    }
    return;
  }
  const queue = new Queue(queueName(job.event_type), {
    connection: queueConnection,
  });
  try {
    await queue.add(
      job.event_type,
      { outboxId: job.id, payload: job.payload },
      {
        jobId: job.id,
        attempts: job.event_type === "media.validate.requested.v1" ? 5 : 1,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
    await pool.execute(
      "UPDATE outbox_events SET status='published',published_at=UTC_TIMESTAMP(3),locked_by=NULL,locked_until=NULL WHERE id=? AND status='processing' AND locked_by=? AND lease_version=? AND locked_until>UTC_TIMESTAMP(3)",
      [job.id, owner, job.lease_version],
    );
  } catch {
    await pool.execute(
      "UPDATE outbox_events SET status=?,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),last_error_code='QUEUE_UNAVAILABLE',locked_by=NULL,locked_until=NULL WHERE id=? AND status='processing' AND locked_by=? AND lease_version=? AND locked_until>UTC_TIMESTAMP(3)",
      [
        job.attempts >= 5 ? "failed" : "pending",
        job.id,
        owner,
        job.lease_version,
      ],
    );
  } finally {
    await queue.close();
  }
}
