import type { SqlTx, DbParam } from "../../../../contracts/shared_types.js";
import { requireValue } from "../../common/errors.js";
import { Paging, queryKeys, uuid, textValue } from "../activities/model.js";
import { RewardsService } from "./service.js";
import {
  RewardRow,
  RedemptionRow,
  reward,
  redemption,
  rewardDto,
  redemptionDto,
} from "./model.js";
export class RewardsQueries {
  private pages: Paging;
  constructor(
    secret: string,
    private service: RewardsService,
  ) {
    this.pages = new Paging(secret);
  }
  async rewards(tx: SqlTx, q: Record<string, unknown>, actor?: string) {
    queryKeys(
      q,
      actor ? ["q", "status", "cursor", "limit"] : ["cursor", "limit"],
    );
    const where = [actor ? "1=1" : "status='published'"],
      values: DbParam[] = [];
    if (q.status !== undefined) {
      requireValue(
        typeof q.status === "string" &&
          ["draft", "published", "archived"].includes(q.status),
        422,
        "INVALID_STATUS",
        "权益状态无效",
      );
      where.push("status=?");
      values.push(q.status);
    }
    if (q.q !== undefined) {
      where.push("title LIKE ?");
      values.push("%" + textValue(q.q, 100, 0) + "%");
    }
    const pg = this.pages.make(q, {
        type: "rewards",
        actor: actor || null,
        q: q.q || null,
        status: q.status || null,
      }),
      cur = pg.where("created_at");
    const rows = await tx.query<RewardRow>(
        `SELECT * FROM point_rewards WHERE ${where.join(" AND ")}${cur.sql} ORDER BY created_at DESC,id DESC LIMIT ${pg.limit + 1}`,
        [...values, ...cur.values],
      ),
      page = pg.page(rows, (r) => r.created_at);
    return {
      ...page,
      items: page.items.map((r) => rewardDto(r, this.service.provider)),
      providerMode: this.service.provider.mode,
    };
  }
  async reward(tx: SqlTx, id: string) {
    return rewardDto(await reward(tx, id), this.service.provider);
  }
  async orders(
    tx: SqlTx,
    actor: string,
    q: Record<string, unknown>,
    admin = false,
  ) {
    queryKeys(
      q,
      admin
        ? ["userId", "status", "cursor", "limit"]
        : ["status", "cursor", "limit"],
    );
    const where = ["1=1"],
      values: DbParam[] = [];
    if (!admin) {
      where.push("user_id=?");
      values.push(actor);
    }
    if (q.userId !== undefined) {
      where.push("user_id=?");
      values.push(uuid(q.userId));
    }
    if (q.status !== undefined) {
      requireValue(
        typeof q.status === "string" &&
          ["pending", "fulfilled", "failed", "refunded"].includes(q.status),
        422,
        "INVALID_STATUS",
        "订单状态无效",
      );
      where.push("status=?");
      values.push(q.status);
    }
    const pg = this.pages.make(q, {
        type: "redemptions",
        actor,
        admin,
        userId: q.userId || null,
        status: q.status || null,
      }),
      cur = pg.where("created_at");
    const rows = await tx.query<RedemptionRow>(
        `SELECT * FROM point_redemptions WHERE ${where.join(" AND ")}${cur.sql} ORDER BY created_at DESC,id DESC LIMIT ${pg.limit + 1}`,
        [...values, ...cur.values],
      ),
      page = pg.page(rows, (r) => r.created_at);
    return {
      ...page,
      items: page.items.map((r) => ({
        ...redemptionDto(r),
        ...(admin
          ? { userId: r.user_id }
          : r.status === "fulfilled" && r.redeem_code_ciphertext
            ? {
                code: this.service.vault.decrypt(
                  r.redeem_code_ciphertext,
                  r.id,
                  r.user_id,
                ),
              }
            : {}),
        testOnly: this.service.provider.mode === "development",
      })),
    };
  }
  async detail(tx: SqlTx, id: string, actor: string, admin = false) {
    const r = await redemption(tx, id, admin ? undefined : actor),
      [event] = await tx.query<{
        status: string;
        attempts: number;
        last_error_code: string | null;
        next_attempt_at: string;
      }>(
        "SELECT status,attempts,last_error_code,next_attempt_at FROM outbox_events WHERE event_key=?",
        ["points.redemption.requested.v1:" + id],
      );
    const ledger = await tx.query<{
      id: string;
      delta: number;
      balance_after: number;
      business_type: string;
      reversal_of: string | null;
      created_at: string;
    }>(
      "SELECT id,delta,balance_after,business_type,reversal_of,created_at FROM point_ledger WHERE user_id=? AND business_id=? ORDER BY created_at,id",
      [r.user_id, r.id],
    );
    return {
      ...redemptionDto(r),
      testOnly: this.service.provider.mode === "development",
      ...(admin
        ? {
            userId: r.user_id,
            execution: event || null,
            codeAvailable: Boolean(r.redeem_code_ciphertext),
            ledger,
          }
        : r.status === "fulfilled" && r.redeem_code_ciphertext
          ? {
              code: this.service.vault.decrypt(
                r.redeem_code_ciphertext,
                r.id,
                r.user_id,
              ),
            }
          : {}),
    };
  }
}
