/** LOCAL TEST infrastructure only; M01 must provide the production implementation. */
import mysql from "mysql2/promise";
import type { Pool, PoolConnection } from "mysql2/promise";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CommandContext,
  DbParam,
  SqlTx,
  UnitOfWork,
} from "../../contracts/shared_types";
import type {
  HealthCommandExecutor,
  HealthHttpRequest,
} from "../../server/src/modules/health/http";
import { HealthError } from "../../server/src/modules/health/errors";
import { businessDate } from "../../server/src/modules/health/validation";
import { mysqlInstant } from "../../server/src/modules/health/repository";

export const dbName = process.env.M02_DB_NAME ?? "qingyang_dev_m02";
if (!/^qingyang_(dev_m02|m02_test_[a-z0-9_]+)$/.test(dbName))
  throw new Error("联调工具仅允许 M02 专用开发或测试数据库");
const options = {
  host: process.env.M02_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.M02_DB_PORT ?? 3308),
  user: process.env.M02_DB_USER ?? "root",
  password: process.env.M02_DB_PASSWORD ?? "",
  timezone: "Z",
  dateStrings: true,
  connectionLimit: 8,
};
export const pool: Pool = mysql.createPool({ ...options, database: dbName });
const txOf = (conn: PoolConnection): SqlTx => ({
  query: async <T extends object>(sql: string, values: readonly DbParam[]) => {
    const [rows] = await conn.query(sql, [...values]);
    return rows as T[];
  },
  execute: async (sql, values) => {
    const [result] = await conn.execute(sql, [...values]);
    return { affectedRows: (result as mysql.ResultSetHeader).affectedRows };
  },
});
export async function initializeEmptyDatabase() {
  const connection = await mysql.createConnection({
    ...options,
    multipleStatements: true,
  });
  try {
    const [version] = await connection.query("SELECT VERSION() AS version");
    if (
      !String((version as { version: string }[])[0].version).startsWith("8.4.")
    )
      throw new Error("必须使用 MySQL 8.4 验收");
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await connection.query(`USE \`${dbName}\``);
    const [tables] = await connection.query("SHOW TABLES");
    if ((tables as unknown[]).length)
      throw new Error("数据库非空，拒绝重复执行 V001；请直接启动服务");
    const sql = await readFile(
      new URL("../../db/migrations/V001__baseline.sql", import.meta.url),
      "utf8",
    );
    const hash = createHash("sha256").update(sql).digest("hex");
    if (
      hash !==
      "64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56"
    )
      throw new Error("基线校验失败");
    await connection.query(sql);
    const ids = JSON.parse(
      await readFile(
        new URL("../../db/seeds/fixture_ids.json", import.meta.url),
        "utf8",
      ),
    );
    // Explicit test identities; no real phone, health history or initial points.
    for (const [key, name] of [
      ["test_user_a", "测试账号 A"],
      ["test_user_b", "测试账号 B"],
    ]) {
      const id = ids[key];
      await connection.execute(
        "INSERT INTO users (id,phone_ciphertext,phone_lookup_hash,nickname) VALUES (?,?,?,?)",
        [
          id,
          "LOCAL_TEST_ONLY",
          createHash("sha256").update(id).digest("hex"),
          name,
        ],
      );
      await connection.execute(
        "INSERT INTO point_accounts (id,user_id) VALUES (?,?)",
        [randomUUID(), id],
      );
    }
    console.log(
      "Applied checksum-verified V001 to empty M02 test database; 2 explicit fixture identities, no health history.",
    );
  } finally {
    await connection.end();
  }
}
async function transaction<T>(
  run: (tx: SqlTx) => Promise<T>,
  readonly = false,
) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET SESSION time_zone='+00:00'");
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query(
      readonly
        ? "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
        : "START TRANSACTION",
    );
    const result = await run(txOf(connection));
    await connection.commit();
    return result;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}
export class LocalUnitOfWork implements UnitOfWork {
  constructor(readonly now: () => Date = () => new Date()) {}
  readSnapshot<T>(run: (tx: SqlTx) => Promise<T>) {
    return transaction(run, true);
  }
  async runForUser<T>(
    userId: string,
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ) {
    return this.runForUsers(userId, [], run);
  }
  async runForUsers<T>(
    userId: string,
    others: readonly string[],
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ) {
    const operationNow = this.now().toISOString();
    for (let attempt = 0; ; attempt++)
      try {
        return await transaction(async (tx) => {
          for (const id of [...new Set([userId, ...others])].sort()) {
            const [user] = await tx.query<{ id: string }>(
              "SELECT id FROM users WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE",
              [id],
            );
            if (!user)
              throw new HealthError(401, "UNAUTHENTICATED", "账号不可用");
          }
          return run(tx, {
            userId,
            operationNow,
            businessDate: businessDate(new Date(operationNow)),
            requestId: randomUUID(),
            platform: "h5",
          });
        });
      } catch (e) {
        if (
          attempt >= 2 ||
          !["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
            (e as { code: string }).code,
          )
        )
          throw e;
      }
  }
  runSystem<T>(
    scope: Parameters<UnitOfWork["runSystem"]>[0],
    run: (
      tx: SqlTx,
      ctx: { operationNow: string; requestId: string },
    ) => Promise<T>,
  ) {
    return transaction((tx) =>
      run(tx, {
        operationNow: this.now().toISOString(),
        requestId: randomUUID(),
      }),
    );
  }
}
export class LocalCommands implements HealthCommandExecutor {
  constructor(
    readonly uow: LocalUnitOfWork,
    readonly assertCsrf: (r: HealthHttpRequest) => void,
  ) {}
  async execute<T>(
    request: HealthHttpRequest,
    status: number,
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ): Promise<T> {
    this.assertCsrf(request);
    const userId = request.identity!.userId;
    if (request.method !== "POST") return this.uow.runForUser(userId, run);
    const key = request.headers["idempotency-key"];
    if (
      !key ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        key,
      )
    )
      throw new HealthError(
        422,
        "VALIDATION_ERROR",
        "POST 必须提供 UUID v4 Idempotency-Key",
      );
    const hash = createHash("sha256")
        .update(JSON.stringify(request.body ?? null))
        .digest("hex"),
      owner = randomUUID();
    const scope = [userId, request.method, request.path, key];
    const claim = await this.uow.runSystem(
      "idempotency_claim",
      async (tx, { operationNow }) => {
        await tx.execute(
          "INSERT IGNORE INTO idempotency_requests (id,principal_key,method,request_path,idempotency_key,body_hash,status,locked_by,locked_until,expires_at) VALUES (?,?,?,?,?,?,'processing',?,DATE_ADD(?,INTERVAL 30 SECOND),DATE_ADD(?,INTERVAL 24 HOUR))",
          [
            randomUUID(),
            ...scope,
            hash,
            owner,
            mysqlInstant(operationNow),
            mysqlInstant(operationNow),
          ],
        );
        const [row] = await tx.query<Record<string, unknown>>(
          "SELECT *,locked_until>UTC_TIMESTAMP(3) AS lease_live FROM idempotency_requests WHERE principal_key=? AND method=? AND request_path=? AND idempotency_key=? FOR UPDATE",
          scope,
        );
        if (row.body_hash !== hash)
          throw new HealthError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "同一幂等键不能用于不同请求",
          );
        if (row.status === "completed") return { row, replay: true };
        if (row.locked_by !== owner) {
          if (row.status === "processing" && Number(row.lease_live))
            throw new HealthError(
              409,
              "REQUEST_IN_PROGRESS",
              "原请求仍在处理中，请稍后用原操作重试",
            );
          await tx.execute(
            "UPDATE idempotency_requests SET status='processing',locked_by=?,locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),lease_version=lease_version+1,response_status=NULL,response_body=NULL WHERE id=?",
            [owner, String(row.id)],
          );
          row.lease_version = Number(row.lease_version) + 1;
        }
        return { row, replay: false };
      },
    );
    if (claim.replay)
      return (
        typeof claim.row.response_body === "string"
          ? JSON.parse(claim.row.response_body)
          : claim.row.response_body
      ) as T;
    try {
      return await this.uow.runForUser(userId, async (tx, ctx) => {
        const [row] = await tx.query<Record<string, unknown>>(
          "SELECT *,locked_until>UTC_TIMESTAMP(3) AS lease_live FROM idempotency_requests WHERE id=? FOR UPDATE",
          [String(claim.row.id)],
        );
        if (
          row.locked_by !== owner ||
          Number(row.lease_version) !== Number(claim.row.lease_version) ||
          !Number(row.lease_live) ||
          row.body_hash !== hash
        )
          throw new HealthError(
            409,
            "REQUEST_IN_PROGRESS",
            "请求租约已失效，请用原操作重试",
          );
        const result = await run(tx, ctx);
        await tx.execute(
          "UPDATE idempotency_requests SET status='completed',locked_by=NULL,locked_until=NULL,response_status=?,response_body=? WHERE id=? AND lease_version=? AND locked_by=?",
          [
            status,
            JSON.stringify(result),
            String(row.id),
            Number(row.lease_version),
            owner,
          ],
        );
        return result;
      });
    } catch (e) {
      await this.uow.runSystem("idempotency_claim", (tx) =>
        tx.execute(
          "UPDATE idempotency_requests SET status='failed',locked_by=NULL,locked_until=NULL,response_status=?,response_body=NULL WHERE id=? AND lease_version=? AND locked_by=?",
          [
            (e as { status?: number }).status ?? 500,
            String(claim.row.id),
            Number(claim.row.lease_version),
            owner,
          ],
        ),
      );
      throw e;
    }
  }
}
