import { createHash, createHmac } from "node:crypto";
import type {
  SqlTx,
  DbParam,
  SlotDto,
  ActivitySnapshot,
  SlotSnapshot,
  BookingDto,
} from "../../../../contracts/shared_types.js";
import { requireValue, UUID_RE } from "../../common/errors.js";
import { asInstant } from "../points/points.js";
import { dateValue, queryKeys } from "../points/queries.js";
export { asInstant, queryKeys };
export interface ActivityRow {
  id: string;
  organizer_user_id: string;
  title: string;
  category: string;
  description: string;
  cover_asset_id: string | null;
  location_name: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  coordinate_system: "wgs84";
  status: "draft" | "published" | "archived";
  visibility: "public" | "private";
  version: number;
  created_at: string;
}
export interface SlotRow {
  id: string;
  activity_id: string;
  start_at: string;
  end_at: string;
  timezone: "Asia/Shanghai";
  capacity: number;
  booked_count: number;
  booking_open_at: string;
  booking_close_at: string;
  cancel_before_at: string;
  status: "open" | "canceled" | "completed";
  version: number;
}
export interface BookingRow {
  id: string;
  user_id: string;
  slot_id: string;
  status: BookingDto["status"];
  participant_visibility: "hidden" | "public";
  booked_at: string;
  canceled_at: string | null;
  cancel_reason: string | null;
  activity_snapshot: ActivitySnapshot | string;
  slot_snapshot: SlotSnapshot | string;
  version: number;
  created_at: string;
}
export const uuid = (id: unknown) => {
  requireValue(
    typeof id === "string" && UUID_RE.test(id),
    422,
    "INVALID_ID",
    "需要有效 UUID",
  );
  return id;
};
export const int = (value: unknown, min = 1, max = 2147483646) => {
  requireValue(
    typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max,
    422,
    "INVALID_INTEGER",
    "整数超出允许范围",
  );
  return value;
};
export const textValue = (v: unknown, max: number, min = 1) => {
  requireValue(
    typeof v === "string" &&
      [...v.trim()].length >= min &&
      [...v.trim()].length <= max,
    422,
    "INVALID_TEXT",
    `文字长度需要 ${min}—${max} 字`,
  );
  return v.trim();
};
export const instant = (v: unknown) => {
  requireValue(
    typeof v === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v &&
      v >= "2020" &&
      v < "2100",
    422,
    "INVALID_INSTANT",
    "需要 UTC 毫秒 ISO 时间",
  );
  return v;
};
export const version = (actual: number, expected: unknown) =>
  requireValue(
    actual === int(expected),
    409,
    "VERSION_CONFLICT",
    "内容已更新，请刷新后再操作",
  );
export const categories = ["walking", "yoga", "running", "workshop", "other"];
export const activitySnapshot = (a: ActivityRow): ActivitySnapshot => ({
  id: a.id,
  title: a.title,
  locationName: a.location_name,
  address: a.address,
  coordinateSystem: a.coordinate_system,
  latitude: a.latitude === null ? null : Number(a.latitude),
  longitude: a.longitude === null ? null : Number(a.longitude),
});
export const activityDto = (a: ActivityRow) => ({
  ...activitySnapshot(a),
  category: a.category,
  description: a.description,
  coverAssetId: a.cover_asset_id,
  coverUrl: null,
  status: a.status,
  visibility: a.visibility,
  version: a.version,
  createdAt: asInstant(a.created_at),
});
export const slotSnapshot = (s: SlotRow): SlotSnapshot => ({
  id: s.id,
  activityId: s.activity_id,
  startAt: asInstant(s.start_at),
  endAt: asInstant(s.end_at),
  timezone: s.timezone,
  bookingOpenAt: asInstant(s.booking_open_at),
  bookingCloseAt: asInstant(s.booking_close_at),
  cancelBeforeAt: asInstant(s.cancel_before_at),
});
export const slotDto = (s: SlotRow): SlotDto => ({
  ...slotSnapshot(s),
  capacity: s.capacity,
  bookedCount: s.booked_count,
  remainingSeats: s.capacity - s.booked_count,
  status: s.status,
  version: s.version,
});
export const jsonObject = <T>(value: T | string): T =>
  typeof value === "string" ? JSON.parse(value) : value;
export const bookingDto = (
  b: BookingRow,
  s: SlotRow,
): BookingDto & { cancelReason: string | null } => ({
  id: b.id,
  slotId: b.slot_id,
  activityId: s.activity_id,
  status: b.status,
  participantVisibility: b.participant_visibility,
  bookedAt: asInstant(b.booked_at),
  canceledAt: b.canceled_at ? asInstant(b.canceled_at) : null,
  cancelReason: b.cancel_reason,
  activityTitle: jsonObject(b.activity_snapshot).title,
  slot: slotDto(s),
  activitySnapshot: jsonObject(b.activity_snapshot),
  slotSnapshot: jsonObject(b.slot_snapshot),
  version: b.version,
});
export async function activity(tx: SqlTx, id: string, lock = false) {
  const [a] = await tx.query<ActivityRow>(
    "SELECT * FROM activities WHERE id=?" + (lock ? " FOR UPDATE" : ""),
    [uuid(id)],
  );
  requireValue(a, 404, "ACTIVITY_NOT_FOUND", "活动不存在或不可见");
  return a;
}
export async function slot(tx: SqlTx, id: string, lock = false) {
  const [s] = await tx.query<SlotRow>(
    "SELECT * FROM activity_slots WHERE id=?" + (lock ? " FOR UPDATE" : ""),
    [uuid(id)],
  );
  requireValue(s, 404, "SLOT_NOT_FOUND", "场次不存在或不可见");
  return s;
}
export const publicActivity = (a: ActivityRow) =>
  requireValue(
    a.status === "published" && a.visibility === "public",
    404,
    "ACTIVITY_NOT_FOUND",
    "活动不存在或不可见",
  );
export function dateRange(q: Record<string, unknown>, required = false) {
  requireValue(
    !required || Boolean(q.startDate && q.endDate),
    422,
    "DATE_RANGE_REQUIRED",
    "请提供起止日期",
  );
  requireValue(
    Boolean(q.startDate) === Boolean(q.endDate),
    422,
    "DATE_RANGE_REQUIRED",
    "请同时提供起止日期",
  );
  if (!q.startDate) return null;
  const start = dateValue(q.startDate),
    end = dateValue(q.endDate);
  requireValue(
    start <= end && Date.parse(end) - Date.parse(start) <= 89 * 86400000,
    422,
    "INVALID_DATE_RANGE",
    "日期最多 90 天",
  );
  return {
    start: new Date(start + "T00:00:00+08:00"),
    end: new Date(Date.parse(end + "T00:00:00+08:00") + 86400000),
  };
}
export class Paging {
  constructor(private secret: string) {}
  make(q: Record<string, unknown>, scope: object, ascending = false) {
    const limit = q.limit === undefined ? 20 : Number(q.limit);
    requireValue(
      typeof q.limit !== "object" &&
        Number.isInteger(limit) &&
        limit >= 1 &&
        limit <= 100,
      422,
      "INVALID_LIMIT",
      "每页需要 1—100 项",
    );
    const filter = createHash("sha256")
      .update(JSON.stringify(scope))
      .digest("hex");
    let cursor: { at: string; id: string } | null = null;
    if (q.cursor !== undefined) {
      requireValue(
        typeof q.cursor === "string" && q.cursor.length < 2048,
        422,
        "INVALID_CURSOR",
        "游标无效",
      );
      try {
        const [raw, sig, ...extra] = q.cursor.split(".");
        requireValue(
          !extra.length &&
            sig === createHmac("sha256", this.secret).update(raw).digest("hex"),
          422,
          "INVALID_CURSOR",
          "游标无效",
        );
        const c = JSON.parse(Buffer.from(raw, "base64url").toString());
        requireValue(
          c.filter === filter &&
            typeof c.at === "string" &&
            /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,3})?$/.test(c.at) &&
            UUID_RE.test(c.id),
          422,
          "CURSOR_FILTER_MISMATCH",
          "账号或筛选变化，请从第一页开始",
        );
        cursor = c;
      } catch (e) {
        if (e && typeof e === "object" && "status" in e) throw e;
        requireValue(false, 422, "INVALID_CURSOR", "游标无效");
      }
    }
    return {
      limit,
      where: (column: string, id = "id") => ({
        sql: cursor
          ? ` AND (${column}${ascending ? ">" : "<"}? OR (${column}=? AND ${id}${ascending ? ">" : "<"}?))`
          : "",
        values: cursor ? ([cursor.at, cursor.at, cursor.id] as DbParam[]) : [],
      }),
      page: <T extends { id: string }>(rows: T[], at: (row: T) => string) => {
        let nextCursor: null | string = null;
        if (rows.length > limit) {
          const r = rows[limit - 1],
            raw = Buffer.from(
              JSON.stringify({ filter, at: at(r), id: r.id }),
            ).toString("base64url");
          nextCursor =
            raw +
            "." +
            createHmac("sha256", this.secret).update(raw).digest("hex");
        }
        return { items: rows.slice(0, limit), nextCursor };
      },
    };
  }
}
