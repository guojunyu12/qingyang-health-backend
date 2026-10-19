import { recoverMedia } from "./common/media-recovery.js";
import { Worker } from "bullmq";
import { queueConnection, queueName, dispatchOnce } from "./common/outbox.js";
import { MediaService } from "./modules/uploads/service.js";
import { pool } from "./common/database.js";
const media = new MediaService();
const worker = new Worker(
  queueName("media.validate.requested.v1"),
  async (job) => {
    const [events] = await pool.execute<any[]>(
      "SELECT payload,event_type FROM outbox_events WHERE id=?",
      [job.data.outboxId],
    );
    if (
      !events.length ||
      events[0].event_type !== "media.validate.requested.v1"
    )
      throw Error("INVALID_EVENT");
    await media.validate(events[0].payload.assetId);
  },
  { connection: queueConnection, concurrency: 2 },
);
worker.on("failed", () =>
  console.error(
    "Media validation job failed; inspect queue state without logging private payload.",
  ),
);
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await dispatchOnce();
    await recoverMedia();
    for (const table of ["auth_challenges", "refresh_tokens"])
      await pool.execute(
        `UPDATE ${table} SET retry_key_hash=NULL,retry_body_hash=NULL,retry_ciphertext=NULL,retry_expires_at=NULL WHERE retry_expires_at<UTC_TIMESTAMP(3)`,
      );
  } catch {
    console.error("Outbox dispatch failed; retrying.");
  } finally {
    running = false;
  }
}, 500);
const close = async () => {
  clearInterval(timer);
  await worker.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
console.log("M01 media worker and Outbox dispatcher started");
