import "../src/common/config.js";
import mysql from "mysql2/promise";
import { env } from "../src/common/config.js";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
export const baselineSha =
  "64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56";
const c = await mysql.createConnection({
  host: env("DB_HOST"),
  port: Number(env("DB_PORT")),
  user: env("DB_MIGRATION_USER"),
  password: env("DB_MIGRATION_PASSWORD"),
  database: env("DB_NAME"),
  multipleStatements: true,
});
try {
  await c.query("SET time_zone='+00:00'");
  await c.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version VARCHAR(16) PRIMARY KEY,sha256 CHAR(64) NOT NULL,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))",
  );
  for (const file of (await readdir("db/migrations"))
    .filter((x) => /^V\d+__.*\.sql$/.test(x))
    .sort()) {
    const version = file.split("__")[0];
    const sql = await readFile("db/migrations/" + file, "utf8");
    const sha = createHash("sha256").update(sql).digest("hex");
    const [applied] = await c.query<any[]>(
      "SELECT sha256 FROM schema_migrations WHERE version=?",
      [version],
    );
    if (applied.length) {
      if (applied[0].sha256 !== sha)
        throw new Error("Migration checksum mismatch: " + version);
      continue;
    }
    if (version === "V001") {
      if (sha !== baselineSha) throw new Error("Frozen baseline mismatch");
      const [tables] = await c.query<any[]>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name<>'schema_migrations'",
      );
      if (tables.length) {
        // Existing local V001 is adopted only after matching all 44 table definitions against a clean baseline below.
        throw new Error(
          "Existing database requires verified baseline adoption; use scripts/adopt-baseline.py first.",
        );
      }
    }
    if (version === "V002") {
      const [users] = await c.query<any[]>("SELECT COUNT(*) AS n FROM users");
      const [challenges] = await c.query<any[]>(
        "SELECT COUNT(*) AS n FROM auth_challenges",
      );
      if (users[0].n || challenges[0].n)
        throw new Error(
          "Legacy phone data exists; explicit identity migration required.",
        );
    }
    await c.query(sql);
    await c.execute(
      "INSERT INTO schema_migrations(version,sha256)VALUES(?,?)",
      [version, sha],
    );
    console.log("Applied " + version);
  }
} finally {
  await c.end();
}
