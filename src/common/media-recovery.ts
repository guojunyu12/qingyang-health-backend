import { Queue } from "bullmq";
import { queueConnection, queueName } from "./outbox.js";
import { pool } from "./database.js";
export async function recoverMedia() {
  const queue = new Queue(queueName("media.validate.requested.v1"), {
    connection: queueConnection,
  });
  try {
    const [records] = await pool.query<any[]>(
      "SELECT m.id,e.id AS event_id,e.status AS event_status FROM media_assets m JOIN outbox_events e ON e.aggregate_id=m.id AND e.event_type='media.validate.requested.v1' WHERE m.status='validating' AND m.updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 SECOND) ORDER BY m.created_at LIMIT 20",
    );
    for (const r of records) {
      if (r.event_status === "failed") {
        await pool.execute(
          "UPDATE media_assets SET status='rejected',error_code='VALIDATION_UNAVAILABLE' WHERE id=? AND status='validating'",
          [r.id],
        );
        continue;
      }
      if (r.event_status !== "published") continue;
      const job = await queue.getJob(r.event_id);
      if (!job) {
        await pool.execute(
          "UPDATE outbox_events SET status='pending',published_at=NULL,locked_by=NULL,locked_until=NULL,next_attempt_at=UTC_TIMESTAMP(3) WHERE id=? AND status='published'",
          [r.event_id],
        );
      } else if ((await job.getState()) === "failed") {
        await pool.execute(
          "UPDATE media_assets SET status='rejected',error_code='VALIDATION_UNAVAILABLE' WHERE id=? AND status='validating'",
          [r.id],
        );
      }
    }
  } finally {
    await queue.close();
  }
}
