/** Explicit two-fixture reset for browser tests; never operate on arbitrary users. */
import { pool } from "./mysql";
if (
  process.env.NODE_ENV === "production" ||
  process.env.M02_TEST_ADAPTERS !== "1"
)
  throw new Error("Fixture reset requires explicit local test mode");
const users = [
  "a0000000-0000-4000-8000-000000000001",
  "a0000000-0000-4000-8000-000000000002",
];
try {
  for (const id of users) {
    for (const table of [
      "point_ledger",
      "point_task_awards",
      "water_records",
      "weight_records",
      "health_profiles",
    ])
      await pool.execute(`DELETE FROM ${table} WHERE user_id=?`, [id]);
    await pool.execute(
      "DELETE FROM idempotency_requests WHERE principal_key=?",
      [id],
    );
    await pool.execute(
      "UPDATE point_accounts SET balance=0,lifetime_earned=0,lifetime_spent=0,version=version+1 WHERE user_id=?",
      [id],
    );
  }
  console.log("Reset only the two explicit M02 fixture identities.");
} finally {
  await pool.end();
}
