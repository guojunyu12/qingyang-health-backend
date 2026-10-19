import type { PoolConnection } from "mysql2/promise";
import type {
  SqlTx,
  UnitOfWork,
  OutboxPort,
  MediaPort,
  PointsPort,
} from "../../contracts/shared_types.js";
import { requireAdmin, audit } from "./foundation.js";
import { unitOfWork } from "./foundation.js";
import { pool, transaction, rows } from "./database.js";
import { randomUUID } from "node:crypto";
import { enqueue } from "./outbox.js";
import { MediaService } from "../modules/uploads/service.js";
import { origin } from "./config.js";
import { digest } from "../modules/identity/crypto.js";
const connections = new WeakMap<object, PoolConnection>();
export function sqlTx(c: PoolConnection): SqlTx {
  const tx: SqlTx = {
    query: async <T extends object>(sql: string, values: readonly any[]) =>
      (await rows(c, sql, [...values])) as T[],
    execute: async (sql, values) => {
      const [result] = await c.execute<any>(sql, [...values]);
      return { affectedRows: result.affectedRows };
    },
  };
  connections.set(tx, c);
  return tx;
}
const raw = (tx: SqlTx) => {
  const c = connections.get(tx);
  if (!c) throw Error("SqlTx must originate from shared UnitOfWork");
  return c;
};
export const unitOfWorkPort: UnitOfWork = {
  runForUser: (id, fn) =>
    unitOfWork.runForUser(id, (c, ctx) => fn(sqlTx(c), ctx)),
  runForUsers: (actor, ids, fn) =>
    unitOfWork.runForUsers(actor, [...ids], (c, ctx) => fn(sqlTx(c), ctx)),
  runSystem: (scope, fn) => {
    if (
      ![
        "auth_bootstrap",
        "idempotency_claim",
        "outbox_claim",
        "delivery_claim",
        "provider_job",
      ].includes(scope)
    )
      throw Error("Invalid system scope");
    return transaction((c) =>
      fn(sqlTx(c), {
        operationNow: new Date().toISOString(),
        requestId: randomUUID(),
      }),
    );
  },
  readSnapshot: async (fn) => {
    const c = await pool.getConnection();
    try {
      await c.query("SET time_zone='+00:00'");
      await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await c.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      const value = await fn(sqlTx(c));
      await c.commit();
      return value;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  },
};
export const outboxPort: OutboxPort = {
  enqueueInTransaction: async (tx, input) => {
    await enqueue(raw(tx), input);
    const r = await rows(
      raw(tx),
      "SELECT id FROM outbox_events WHERE event_key=?",
      [input.eventKey],
    );
    return { id: r[0].id };
  },
};
const media = new MediaService();
export const mediaPort: MediaPort = {
  assertReady: async (tx, input) => {
    const a = await media.assertReady(raw(tx), input);
    return {
      assetId: a.id,
      purpose: a.purpose,
      userId: a.user_id,
      contentType: a.safe_content_type,
      sizeBytes: Number(a.safe_size_bytes),
    };
  },
  createReadUrl: async (input) => {
    await transaction((c) => media.assertReady(c, input));
    const seconds = Math.min(300, input.expiresInSeconds ?? 300);
    if (!Number.isInteger(seconds) || seconds < 1)
      throw Error("Invalid signed media TTL");
    const exp = Math.floor(Date.now() / 1000) + seconds;
    return {
      assetId: input.assetId,
      readUrl:
        origin +
        `/api/v1/uploads/read/${input.assetId}?expires=${exp}&signature=${digest("get:" + input.assetId + ":" + exp)}`,
      readUrlExpiresAt: new Date(exp * 1000).toISOString(),
    };
  },
};
/** M05 registers its real port; no zero-balance mock or cross-module writes here. */
export const modulePorts: { points?: PointsPort } = {};

export const userAdministrationPort = {
  disableInTransaction: async (
    tx: SqlTx,
    ctx: import("../../contracts/shared_types.js").CommandContext,
    targetUserId: string,
  ) => {
    const c = raw(tx);
    await requireAdmin(c, ctx.userId);
    await c.execute(
      "UPDATE users SET status='disabled' WHERE id=? AND status='active'",
      [targetUserId],
    );
    await c.execute(
      "UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)),access_token_hash=NULL WHERE user_id=?",
      [targetUserId],
    );
    await audit(c, ctx, "user.disable", "user", targetUserId, {});
  },
};
