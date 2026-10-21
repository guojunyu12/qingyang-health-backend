import { randomUUID, createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { transaction, rows } from "./database.js";
import { reject, ApiFailure } from "./error.js";
export const isUuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    x,
  );
export const canonical = (v: unknown): string =>
  JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, JSON.parse(canonical(x))]),
          )
      : (v ?? null),
  );
export function safeAction(p: string) {
  if (
    ![
      "/dashboard",
      "/nutrition",
      "/training",
      "/companion",
      "/profile",
      "/overview",
    ].includes(p) &&
    !/^\/m05\/(points|rewards|redemptions|activities|bookings|community)(\/[0-9a-f-]{36})?$/.test(
      p,
    )
  )
    reject(422, "INVALID_ACTION", "通知跳转地址无效");
  return p;
}
export type Context = {
  userId: string;
  operationNow: string;
  businessDate: string;
  requestId: string;
  platform: "h5" | "ios" | "android";
};
const context = (userId: string): Context => {
  const d = new Date();
  return {
    userId,
    operationNow: d.toISOString(),
    businessDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d),
    requestId: randomUUID(),
    platform: "h5",
  };
};
export async function lockUsers(
  c: PoolConnection,
  ids: string[],
  activeUserId?: string,
) {
  for (const id of [...new Set(ids)].sort()) {
    const u = (
      await rows(c, "SELECT id,status FROM users WHERE id=? FOR UPDATE", [id])
    )[0];
    if (!u || ((!activeUserId || id === activeUserId) && u.status !== "active"))
      reject(403, "ACCOUNT_DISABLED", "账号不可用");
  }
}
export const unitOfWork = {
  runForUser: <T>(
    id: string,
    fn: (c: PoolConnection, ctx: Context) => Promise<T>,
  ) => {
    const ctx = context(id);
    return transaction(async (c) => {
      await lockUsers(c, [id]);
      return fn(c, ctx);
    });
  },
  runForUsers: <T>(
    actor: string,
    ids: string[],
    fn: (c: PoolConnection, ctx: Context) => Promise<T>,
  ) => {
    const ctx = context(actor);
    return transaction(async (c) => {
      await lockUsers(c, [actor, ...ids], actor);
      return fn(c, ctx);
    });
  },
};
export async function idempotent<T>(
  userId: string,
  method: string,
  path: string,
  key: unknown,
  body: unknown,
  fn: (c: PoolConnection, ctx: Context) => Promise<T>,
  responseStatus = 200,
  referencedUserIds: readonly string[] = [],
): Promise<T> {
  if (!isUuid(key))
    reject(422, "INVALID_IDEMPOTENCY_KEY", "缺少有效的幂等请求标识");
  const principal = "user:" + userId;
  const bodyHash = createHash("sha256").update(canonical(body)).digest("hex");
  const owner = randomUUID();
  const lease = await transaction(async (c) => {
    await c.execute(
      "INSERT INTO idempotency_requests(id,principal_key,method,request_path,idempotency_key,body_hash,status,expires_at,locked_by,locked_until) VALUES(?,?,?,?,?,?,'processing',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND)) ON DUPLICATE KEY UPDATE id=id",
      [randomUUID(), principal, method, path, key, bodyHash, owner],
    );
    const r = (
      await rows(
        c,
        "SELECT * FROM idempotency_requests WHERE principal_key=? AND method=? AND request_path=? AND idempotency_key=? FOR UPDATE",
        [principal, method, path, key],
      )
    )[0];
    if (r.body_hash !== bodyHash)
      reject(409, "IDEMPOTENCY_CONFLICT", "同一请求标识对应了不同内容");
    if (r.status !== "processing") return { cached: true, row: r };
    if (r.locked_by !== owner) {
      if (
        new Date(r.locked_until.replace(" ", "T") + "Z").getTime() > Date.now()
      )
        reject(409, "REQUEST_IN_PROGRESS", "请求正在处理中", 2);
      await c.execute(
        "UPDATE idempotency_requests SET locked_by=?,locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),lease_version=lease_version+1 WHERE id=?",
        [owner, r.id],
      );
      r.lease_version++;
    }
    return { cached: false, row: r };
  });
  if (lease.cached) {
    if (lease.row.status === "failed") {
      const e = lease.row.response_body;
      throw new ApiFailure(lease.row.response_status, e.code, e.message);
    }
    return lease.row.response_body as T;
  }
  try {
    return await unitOfWork.runForUsers(
      userId,
      [...referencedUserIds],
      async (c, ctx) => {
        const r = (
          await rows(
            c,
            "SELECT * FROM idempotency_requests WHERE id=? FOR UPDATE",
            [lease.row.id],
          )
        )[0];
        if (
          r.status !== "processing" ||
          r.locked_by !== owner ||
          r.lease_version !== lease.row.lease_version ||
          new Date(r.locked_until.replace(" ", "T") + "Z").getTime() <=
            Date.now()
        )
          reject(409, "REQUEST_IN_PROGRESS", "请求租约已变化", 2);
        const data = await fn(c, ctx);
        await c.execute(
          "UPDATE idempotency_requests SET status='completed',response_status=?,response_body=?,locked_by=NULL,locked_until=NULL WHERE id=? AND locked_by=? AND lease_version=?",
          [
            responseStatus,
            JSON.stringify(data ?? null),
            r.id,
            owner,
            r.lease_version,
          ],
        );
        return data;
      },
    );
  } catch (e) {
    if (
      e instanceof ApiFailure &&
      e.status >= 400 &&
      e.status < 500 &&
      e.code !== "REQUEST_IN_PROGRESS"
    ) {
      await transaction(async (c) => {
        await c.execute(
          "UPDATE idempotency_requests SET status='failed',response_status=?,response_body=?,locked_by=NULL,locked_until=NULL WHERE id=? AND locked_by=? AND lease_version=? AND status='processing'",
          [
            e.status,
            JSON.stringify({ code: e.code, message: e.message }),
            lease.row.id,
            owner,
            lease.row.lease_version,
          ],
        );
      });
    }
    throw e;
  }
}
export async function audit(
  c: PoolConnection,
  ctx: Context,
  action: string,
  type: string,
  id: string | null,
  summary: object,
) {
  await c.execute(
    "INSERT INTO audit_logs(id,actor_user_id,action,resource_type,resource_id,request_id,change_summary)VALUES(?,?,?,?,?,?,?)",
    [
      randomUUID(),
      ctx.userId,
      action,
      type,
      id,
      ctx.requestId,
      JSON.stringify(summary),
    ],
  );
}
export async function requireAdmin(c: PoolConnection, userId: string) {
  if (
    !(
      await rows(
        c,
        "SELECT id FROM user_roles WHERE user_id=? AND role='admin'",
        [userId],
      )
    ).length
  )
    reject(403, "ADMIN_REQUIRED", "需要管理员权限");
}
