import type { SqlTx, DbParam } from "../../../../contracts/shared_types.js";
import { requireValue } from "../../common/errors.js";
import { ActivitiesService } from "./service.js";
import {
  Paging,
  ActivityRow,
  SlotRow,
  BookingRow,
  activity,
  slot,
  activityDto,
  slotDto,
  bookingDto,
  publicActivity,
  dateRange,
  queryKeys,
  uuid,
  textValue,
  asInstant,
  categories,
} from "./model.js";
export class ActivitiesQueries {
  private paging: Paging;
  constructor(secret: string) {
    this.paging = new Paging(secret);
  }
  async activities(
    tx: SqlTx,
    q: Record<string, unknown>,
    now: string,
    adminId?: string,
  ) {
    queryKeys(
      q,
      adminId
        ? ["q", "status", "cursor", "limit"]
        : ["category", "startDate", "endDate", "cursor", "limit"],
    );
    const range = dateRange(q),
      where: string[] = [],
      values: DbParam[] = [];
    if (!adminId) where.push("a.status='published' AND a.visibility='public'");
    if (q.category !== undefined) {
      requireValue(
        typeof q.category === "string" && categories.includes(q.category),
        422,
        "INVALID_CATEGORY",
        "分类无效",
      );
      where.push("a.category=?");
      values.push(q.category);
    }
    if (q.status !== undefined) {
      requireValue(
        typeof q.status === "string" &&
          ["draft", "published", "archived"].includes(q.status),
        422,
        "INVALID_STATUS",
        "活动状态无效",
      );
      where.push("a.status=?");
      values.push(q.status);
    }
    if (q.q !== undefined) {
      where.push("a.title LIKE ?");
      values.push("%" + textValue(q.q, 100, 0) + "%");
    }
    if (range) {
      where.push(
        "EXISTS (SELECT 1 FROM activity_slots s WHERE s.activity_id=a.id AND s.status='open' AND s.start_at>=? AND s.start_at<? AND s.end_at>=?)",
      );
      values.push(range.start, range.end, new Date(now));
    }
    const pg = this.paging.make(q, {
        type: "activities",
        adminId: adminId || null,
        category: q.category || null,
        status: q.status || null,
        q: q.q || null,
        start: q.startDate || null,
        end: q.endDate || null,
      }),
      cur = pg.where("a.created_at", "a.id");
    const rows = await tx.query<ActivityRow>(
      `SELECT a.* FROM activities a WHERE ${where.join(" AND ") || "1=1"}${cur.sql} ORDER BY a.created_at DESC,a.id DESC LIMIT ${pg.limit + 1}`,
      [...values, ...cur.values],
    );
    const page = pg.page(rows, (r) => r.created_at),
      items = [];
    for (const a of page.items) {
      const [next] = await tx.query<SlotRow>(
        "SELECT * FROM activity_slots WHERE activity_id=? AND status='open' AND end_at>=? ORDER BY start_at,id LIMIT 1",
        [a.id, new Date(now)],
      );
      items.push({ ...activityDto(a), nextSlot: next ? slotDto(next) : null });
    }
    return { ...page, items };
  }
  async detail(tx: SqlTx, id: string, now: string, admin = false) {
    const a = await activity(tx, id);
    if (!admin) publicActivity(a);
    const future = await tx.query<SlotRow>(
      "SELECT * FROM activity_slots WHERE activity_id=? AND status='open' AND end_at>=? ORDER BY start_at,id LIMIT 20",
      [id, new Date(now)],
    );
    return { ...activityDto(a), slots: future.map(slotDto), serverNow: now };
  }
  async slots(
    tx: SqlTx,
    id: string,
    q: Record<string, unknown>,
    now: string,
    adminId?: string,
  ) {
    queryKeys(
      q,
      adminId
        ? ["startDate", "endDate", "status", "cursor", "limit"]
        : ["startDate", "endDate", "cursor", "limit"],
    );
    const a = await activity(tx, id);
    if (!adminId) publicActivity(a);
    const range = dateRange(q, !adminId),
      where = ["activity_id=?"],
      values: DbParam[] = [id];
    if (!adminId) {
      where.push("status='open' AND end_at>=?");
      values.push(new Date(now));
    }
    if (range) {
      where.push("start_at>=? AND start_at<?");
      values.push(range.start, range.end);
    }
    if (q.status !== undefined) {
      requireValue(
        typeof q.status === "string" &&
          ["open", "canceled", "completed"].includes(q.status),
        422,
        "INVALID_STATUS",
        "场次状态无效",
      );
      where.push("status=?");
      values.push(q.status);
    }
    const pg = this.paging.make(
        q,
        {
          type: "slots",
          id,
          adminId: adminId || null,
          start: q.startDate || null,
          end: q.endDate || null,
          status: q.status || null,
        },
        true,
      ),
      cur = pg.where("start_at");
    const rows = await tx.query<SlotRow>(
      `SELECT * FROM activity_slots WHERE ${where.join(" AND ")}${cur.sql} ORDER BY start_at,id LIMIT ${pg.limit + 1}`,
      [...values, ...cur.values],
    );
    const page = pg.page(rows, (r) => r.start_at);
    return { ...page, items: page.items.map(slotDto) };
  }
  async bookings(
    tx: SqlTx,
    actorId: string,
    q: Record<string, unknown>,
    admin = false,
  ) {
    queryKeys(
      q,
      admin
        ? ["activityId", "slotId", "status", "cursor", "limit"]
        : ["status", "cursor", "limit"],
    );
    const where = ["1=1"],
      values: DbParam[] = [];
    if (!admin) {
      where.push("b.user_id=?");
      values.push(actorId);
    }
    for (const [key, col] of [
      ["activityId", "s.activity_id"],
      ["slotId", "b.slot_id"],
    ])
      if (q[key] !== undefined) {
        where.push(col + "=?");
        values.push(uuid(q[key]));
      }
    if (q.status !== undefined) {
      requireValue(
        typeof q.status === "string" &&
          ["confirmed", "canceled", "attended", "no_show"].includes(q.status),
        422,
        "INVALID_STATUS",
        "预约状态无效",
      );
      where.push("b.status=?");
      values.push(q.status);
    }
    const pg = this.paging.make(q, {
        type: "bookings",
        actorId,
        admin,
        activityId: q.activityId || null,
        slotId: q.slotId || null,
        status: q.status || null,
      }),
      cur = pg.where("b.created_at", "b.id");
    const rows = await tx.query<BookingRow & { nickname: string }>(
      `SELECT b.*,u.nickname FROM activity_bookings b JOIN activity_slots s ON s.id=b.slot_id JOIN users u ON u.id=b.user_id WHERE ${where.join(" AND ")}${cur.sql} ORDER BY b.created_at DESC,b.id DESC LIMIT ${pg.limit + 1}`,
      [...values, ...cur.values],
    );
    const page = pg.page(rows, (r) => r.created_at),
      items = [];
    for (const b of page.items)
      items.push({
        ...bookingDto(b, await slot(tx, b.slot_id)),
        ...(admin ? { userId: b.user_id, nickname: b.nickname } : {}),
      });
    return { ...page, items };
  }
  async bookingDetail(tx: SqlTx, id: string, owner: string) {
    const b = await new ActivitiesService().booking(tx, id, owner),
      events = await tx.query<{
        id: string;
        action: string;
        reason: string | null;
        occurred_at: string;
      }>(
        "SELECT id,action,reason,occurred_at FROM booking_events WHERE booking_id=? ORDER BY occurred_at,id",
        [id],
      );
    return {
      ...bookingDto(b, await slot(tx, b.slot_id)),
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        reason: e.reason,
        occurredAt: asInstant(e.occurred_at),
      })),
    };
  }
  async participants(
    tx: SqlTx,
    id: string,
    actorId: string,
    q: Record<string, unknown>,
  ) {
    queryKeys(q, ["cursor", "limit"]);
    const s = await slot(tx, id);
    publicActivity(await activity(tx, s.activity_id));
    requireValue(
      s.status !== "canceled",
      404,
      "SLOT_NOT_FOUND",
      "场次不存在或不可见",
    );
    const pg = this.paging.make(q, { type: "participants", id, actorId }),
      cur = pg.where("b.created_at", "b.id");
    const rows = await tx.query<{
      id: string;
      created_at: string;
      user_id: string;
      nickname: string;
    }>(
      `SELECT b.id,b.created_at,b.user_id,u.nickname FROM activity_bookings b JOIN users u ON u.id=b.user_id WHERE b.slot_id=? AND b.status<>'canceled' AND b.participant_visibility='public' AND u.status='active' AND u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_blocks x WHERE (x.user_id=? AND x.blocked_user_id=u.id) OR (x.user_id=u.id AND x.blocked_user_id=?))${cur.sql} ORDER BY b.created_at DESC,b.id DESC LIMIT ${pg.limit + 1}`,
      [id, actorId, actorId, ...cur.values],
    );
    const page = pg.page(rows, (r) => r.created_at);
    return {
      ...page,
      items: page.items.map((r) => ({
        userId: r.user_id,
        nickname: r.nickname,
        avatarUrl: null,
      })),
    };
  }
}
