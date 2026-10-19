import { pool } from "../src/common/database.js";
import { MediaService } from "../src/modules/uploads/service.js";
try {
  const [records] = await pool.query<any[]>(
    "SELECT id FROM media_assets WHERE status='ready' AND safe_size_bytes IS NULL",
  );
  console.log("Legacy safe assets requiring revalidation:", records.length);
  if (records.length && !process.argv.includes("--apply"))
    throw Error(
      "Dry run only. Back up media and stop API traffic, then rerun with --apply.",
    );
  const service = new MediaService();
  for (const r of records) {
    await pool.execute(
      "UPDATE media_assets SET status='validating' WHERE id=? AND status='ready' AND safe_size_bytes IS NULL",
      [r.id],
    );
    await service.validate(r.id);
  }
  const [remaining] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM media_assets WHERE status='ready' AND safe_size_bytes IS NULL",
  );
  if (remaining[0].n) throw Error("Media backfill remains incomplete");
  console.log(
    "Safe-media revalidation complete; inspect rejected assets before restoring traffic.",
  );
} finally {
  await pool.end();
}
