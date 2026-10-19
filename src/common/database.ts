import mysql, { type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { env } from "./config.js";
export const pool = mysql.createPool({
  host: env("DB_HOST", "127.0.0.1"),
  port: Number(env("DB_PORT", "3307")),
  user: env("DB_USER"),
  password: env("DB_PASSWORD"),
  database: env("DB_NAME"),
  timezone: "Z",
  dateStrings: true,
  connectionLimit: 10,
  multipleStatements: false,
});
export async function transaction<T>(
  fn: (c: PoolConnection) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await pool.getConnection();
    try {
      await c.query("SET time_zone='+00:00'");
      await c.beginTransaction();
      const result = await fn(c);
      await c.commit();
      return result;
    } catch (e: any) {
      await c.rollback();
      if (
        attempt < 2 &&
        ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(e.code)
      )
        continue;
      throw e;
    } finally {
      c.release();
    }
  }
}
export async function rows(
  c: PoolConnection,
  sql: string,
  values: any[] = [],
): Promise<RowDataPacket[]> {
  return (await c.execute<RowDataPacket[]>(sql, values))[0];
}
