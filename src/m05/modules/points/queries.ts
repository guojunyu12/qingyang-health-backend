import { createHash, createHmac } from "node:crypto";
import type { SqlTx, DbParam } from "../../../../contracts/shared_types.js";
import { requireValue, UUID_RE } from "../../common/errors.js";
import { asInstant, accountDto } from "./points.js";
export function dateValue(value: unknown, label = "date"): string {
  requireValue(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value,
    422,
    "INVALID_DATE",
    `${label} 需要真实 YYYY-MM-DD 日期`,
  );
  return value;
}
export function queryKeys(query: object, allowed: string[]) {
  requireValue(
    Object.keys(query).every((k) => allowed.includes(k)),
    422,
    "UNKNOWN_QUERY",
    "请求包含未声明的筛选条件",
  );
}
export class PointQueries {
  constructor(private secret: string) {}
  private paging(query: Record<string, unknown>, scope: object) {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    requireValue(
      typeof query.limit !== "object" &&
        Number.isInteger(limit) &&
        limit >= 1 &&
        limit <= 100,
      422,
      "INVALID_LIMIT",
      "limit 范围为 1—100",
    );
    const filter = createHash("sha256")
      .update(JSON.stringify(scope))
      .digest("hex");
    let cursor: { at: string; id: string } | null = null;
    if (query.cursor !== undefined) {
      requireValue(
        typeof query.cursor === "string" && query.cursor.length < 2048,
        422,
        "INVALID_CURSOR",
        "分页游标无效",
      );
      try {
        const [raw, signature, ...extra] = query.cursor.split(".");
        requireValue(
          !extra.length &&
            signature ===
              createHmac("sha256", this.secret).update(raw).digest("hex"),
          422,
          "INVALID_CURSOR",
          "分页游标无效",
        );
        const data = JSON.parse(Buffer.from(raw, "base64url").toString());
        requireValue(
          data.filter === filter &&
            UUID_RE.test(data.id) &&
            typeof data.at === "string" &&
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(data.at),
          422,
          "CURSOR_FILTER_MISMATCH",
          "筛选或账号变化后请从第一页开始",
        );
        cursor = data;
      } catch (e) {
        if (e instanceof Error && "status" in e) throw e;
        requireValue(false, 422, "INVALID_CURSOR", "分页游标无效");
      }
    }
    const next = (r: { created_at: string; id: string }) => {
      const raw = Buffer.from(
        JSON.stringify({ filter, at: r.created_at, id: r.id }),
      ).toString("base64url");
      return (
        raw + "." + createHmac("sha256", this.secret).update(raw).digest("hex")
      );
    };
    return { limit, cursor, next };
  }
  async ledger(
    tx: SqlTx,
    actorId: string,
    query: Record<string, unknown>,
    admin = false,
  ) {
    queryKeys(
      query,
      admin
        ? ["userId", "startDate", "endDate", "businessType", "cursor", "limit"]
        : ["startDate", "endDate", "cursor", "limit"],
    );
    const userId = admin ? (query.userId as string | undefined) : actorId;
    if (userId)
      requireValue(
        typeof userId === "string" && UUID_RE.test(userId),
        422,
        "INVALID_USER",
        "用户编号无效",
      );
    requireValue(
      Boolean(query.startDate) === Boolean(query.endDate),
      422,
      "DATE_RANGE_REQUIRED",
      "起止日期需要同时填写",
    );
    const start = query.startDate
        ? dateValue(query.startDate, "startDate")
        : null,
      end = query.endDate ? dateValue(query.endDate, "endDate") : null;
    if (start && end)
      requireValue(
        start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 <= 89,
        422,
        "INVALID_DATE_RANGE",
        "日期区间最多 90 天",
      );
    const type = query.businessType as string | undefined;
    if (type)
      requireValue(
        [
          "task_award",
          "redemption",
          "redemption_refund",
          "adjustment",
        ].includes(type),
        422,
        "INVALID_BUSINESS_TYPE",
        "流水类型无效",
      );
    const { limit, cursor, next } = this.paging(query, {
      kind: "ledger",
      actorId,
      admin,
      userId: userId || null,
      start,
      end,
      type: type || null,
    });
    const where = ["1=1"],
      values: DbParam[] = [];
    if (userId) {
      where.push("l.user_id=?");
      values.push(userId);
    }
    if (start && end) {
      where.push("l.business_date BETWEEN ? AND ?");
      values.push(start, end);
    }
    if (type) {
      where.push("l.business_type=?");
      values.push(type);
    }
    if (cursor) {
      where.push("(l.created_at<? OR (l.created_at=? AND l.id<?))");
      values.push(cursor.at, cursor.at, cursor.id);
    }
    const rows = await tx.query<{
      id: string;
      user_id: string;
      nickname: string;
      delta: number;
      balance_after: number;
      reason: string;
      business_date: string;
      business_type: string;
      business_id: string;
      created_at: string;
      task_code: string | null;
      rule_version: number | null;
      source_type: string | null;
      source_id: string | null;
      scope_key: string | null;
    }>(
      `SELECT l.*,u.nickname,a.task_code,a.rule_version,a.source_type,a.source_id,a.scope_key FROM point_ledger l JOIN users u ON u.id=l.user_id LEFT JOIN point_task_awards a ON l.business_type='task_award' AND a.id=l.business_id WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC,l.id DESC LIMIT ${limit + 1}`,
      values,
    );
    return {
      items: rows
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          ...(admin ? { userId: r.user_id, nickname: r.nickname } : {}),
          delta: Number(r.delta),
          balanceAfter: Number(r.balance_after),
          reason: r.reason,
          businessDate: r.business_date,
          businessType: r.business_type,
          businessId: r.business_id,
          createdAt: asInstant(r.created_at),
          taskCode: r.task_code,
          ruleVersion: r.rule_version === null ? null : Number(r.rule_version),
          sourceType: r.source_type,
          sourceId: r.source_id,
          scopeKey: r.scope_key,
        })),
      nextCursor: rows.length > limit ? next(rows[limit - 1]) : null,
    };
  }
  async accounts(tx: SqlTx, actorId: string, query: Record<string, unknown>) {
    queryKeys(query, ["userId", "cursor", "limit"]);
    const userId = query.userId as string | undefined;
    if (userId)
      requireValue(
        typeof userId === "string" && UUID_RE.test(userId),
        422,
        "INVALID_USER",
        "用户编号无效",
      );
    const { limit, cursor, next } = this.paging(query, {
      kind: "accounts",
      actorId,
      userId: userId || null,
    });
    const where = ["1=1"],
      values: DbParam[] = [];
    if (userId) {
      where.push("a.user_id=?");
      values.push(userId);
    }
    if (cursor) {
      where.push("(a.created_at<? OR (a.created_at=? AND a.id<?))");
      values.push(cursor.at, cursor.at, cursor.id);
    }
    const rows = await tx.query<{
      id: string;
      user_id: string;
      nickname: string;
      balance: number;
      lifetime_earned: number;
      lifetime_spent: number;
      version: number;
      created_at: string;
      ledger_balance: string;
      ledger_earned: string;
      ledger_spent: string;
    }>(
      `SELECT a.*,u.nickname,COALESCE(t.net,0) ledger_balance,COALESCE(t.earned,0) ledger_earned,COALESCE(t.spent,0) ledger_spent FROM point_accounts a JOIN users u ON u.id=a.user_id LEFT JOIN (SELECT user_id,SUM(delta) net,SUM(CASE WHEN delta>0 THEN delta ELSE 0 END) earned,SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END) spent FROM point_ledger GROUP BY user_id) t ON t.user_id=a.user_id WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC,a.id DESC LIMIT ${limit + 1}`,
      values,
    );
    return {
      items: rows
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          userId: r.user_id,
          nickname: r.nickname,
          ...accountDto(r),
          createdAt: asInstant(r.created_at),
          ledgerBalance: Number(r.ledger_balance),
          balanceDifference: Number(r.balance) - Number(r.ledger_balance),
          earnedDifference: Number(r.lifetime_earned) - Number(r.ledger_earned),
          spentDifference: Number(r.lifetime_spent) - Number(r.ledger_spent),
          identityDifference:
            Number(r.balance) -
            (Number(r.lifetime_earned) - Number(r.lifetime_spent)),
        })),
      nextCursor: rows.length > limit ? next(rows[limit - 1]) : null,
    };
  }
}
