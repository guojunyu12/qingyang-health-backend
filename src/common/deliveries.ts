import { randomUUID } from "node:crypto";
import { pool, transaction, rows } from "./database.js";
/** Provider adapter must reject known invalid subscriptions with code INVALID_SUBSCRIPTION. */
export type PushSender = (
  subscription: Record<string, unknown>,
  notification: Record<string, unknown>,
  stableId: string,
) => Promise<string>;
export async function deliverOnce(sender: PushSender) {
  const owner = randomUUID();
  const job: any = await transaction(async (c) => {
    const r = (
      await rows(
        c,
        "SELECT * FROM notification_deliveries WHERE status='queued' AND next_attempt_at<=UTC_TIMESTAMP(3) AND (locked_until IS NULL OR locked_until<UTC_TIMESTAMP(3)) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      )
    )[0];
    if (!r) return null;
    await c.execute(
      "UPDATE notification_deliveries SET locked_by=?,locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),lease_version=lease_version+1,attempts=attempts+1 WHERE id=?",
      [owner, r.id],
    );
    return {
      ...r,
      lease_version: Number(r.lease_version) + 1,
      attempts: Number(r.attempts) + 1,
    };
  });
  if (!job) return;
  const update = async (
    status: string,
    error: string | null,
    providerId: string | null,
  ) => {
    await pool.execute(
      "UPDATE notification_deliveries SET status=?,last_error_code=?,provider_message_id=?,sent_at=CASE WHEN ?='sent' THEN UTC_TIMESTAMP(3) ELSE NULL END,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),locked_by=NULL,locked_until=NULL WHERE id=? AND locked_by=? AND lease_version=? AND status='queued' AND locked_until>UTC_TIMESTAMP(3)",
      [status, error, providerId, status, job.id, owner, job.lease_version],
    );
  };
  const [subscriptions] = await pool.execute<any[]>(
    "SELECT * FROM notification_subscriptions WHERE id=? AND user_id=? AND enabled=1",
    [job.subscription_id, job.user_id],
  );
  const [notices] = await pool.execute<any[]>(
    "SELECT * FROM notifications WHERE id=? AND user_id=?",
    [job.notification_id, job.user_id],
  );
  if (!subscriptions.length || !notices.length) {
    await update("invalid_subscription", "SUBSCRIPTION_DISABLED", null);
    return;
  }
  try {
    const id = await sender(subscriptions[0], notices[0], job.id);
    await update("sent", null, id);
  } catch (e: any) {
    if (e.code === "INVALID_SUBSCRIPTION") {
      await pool.execute(
        "UPDATE notification_subscriptions SET enabled=0 WHERE id=? AND user_id=?",
        [job.subscription_id, job.user_id],
      );
      await update("invalid_subscription", "INVALID_SUBSCRIPTION", null);
    } else
      await update(
        job.attempts >= 5 ? "failed" : "queued",
        "PROVIDER_UNAVAILABLE",
        null,
      );
  }
}
