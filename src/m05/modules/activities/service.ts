import { randomUUID } from "node:crypto";
import type {
  SqlTx,
  CommandContext,
  ActivitiesQueryPort,
  MediaPort,
} from "../../../../contracts/shared_types.js";
import { exactBody, requireValue } from "../../common/errors.js";
import { LocalAudit, LocalOutbox } from "../../common/ports.js";
import {
  ActivityRow,
  SlotRow,
  BookingRow,
  activity,
  slot,
  activityDto,
  slotDto,
  bookingDto,
  activitySnapshot,
  slotSnapshot,
  asInstant,
  uuid,
  int,
  textValue,
  instant,
  version,
  publicActivity,
  categories,
} from "./model.js";
export class ActivitiesService implements ActivitiesQueryPort {
  constructor(
    private media?: MediaPort,
    private checkpoint?: (
      point: "after_seat" | "after_booking" | "after_event",
    ) => void,
  ) {}
  async activeBookingCount(tx: SqlTx, userId: string, at: string) {
    const [r] = await tx.query<{ n: number }>(
      "SELECT COUNT(*) n FROM activity_bookings b JOIN activity_slots s ON s.id=b.slot_id JOIN activities a ON a.id=s.activity_id WHERE b.user_id=? AND b.status='confirmed' AND s.status='open' AND s.end_at>=? AND a.status='published' AND a.visibility='public'",
      [uuid(userId), new Date(instant(at))],
    );
    return Number(r.n);
  }
  async assertAdmin(tx: SqlTx, id: string) {
    requireValue(
      (
        await tx.query(
          "SELECT role FROM user_roles WHERE user_id=? AND role=?",
          [id, "admin"],
        )
      ).length,
      403,
      "ADMIN_REQUIRED",
      "需要管理员权限",
    );
  }
  private async cover(tx: SqlTx, actor: string, id: unknown) {
    if (id === null) return;
    uuid(id);
    requireValue(
      this.media,
      503,
      "MEDIA_NOT_CONFIGURED",
      "封面素材端口尚未接入，可先不设置封面",
    );
    await this.media.assertReady(tx, {
      assetId: id as string,
      purpose: "activity_cover",
      actorUserId: actor,
      access: "admin_material",
    });
  }
  async saveActivity(
    tx: SqlTx,
    ctx: CommandContext,
    body: Record<string, unknown>,
    id?: string,
  ) {
    await this.assertAdmin(tx, ctx.userId);
    exactBody(
      body,
      id
        ? [
            "version",
            "title",
            "category",
            "description",
            "coverAssetId",
            "locationName",
            "address",
            "latitude",
            "longitude",
            "visibility",
          ]
        : [
            "title",
            "category",
            "description",
            "coverAssetId",
            "locationName",
            "address",
            "latitude",
            "longitude",
            "visibility",
          ],
    );
    const old = id ? await activity(tx, id, true) : null;
    if (old) {
      version(old.version, body.version);
      requireValue(
        old.status !== "archived",
        409,
        "ACTIVITY_ARCHIVED",
        "归档活动不可编辑",
      );
    }
    const value = (key: string, oldValue: unknown, fallback?: unknown) =>
      body[key] === undefined ? (old ? oldValue : fallback) : body[key];
    const title = textValue(value("title", old?.title), 100),
      category = textValue(value("category", old?.category), 32),
      description = textValue(value("description", old?.description), 10000),
      locationName = textValue(value("locationName", old?.location_name), 150),
      address = textValue(value("address", old?.address), 1000);
    requireValue(
      categories.includes(category),
      422,
      "INVALID_CATEGORY",
      "活动分类无效",
    );
    const visibility = value("visibility", old?.visibility, "public");
    requireValue(
      ["public", "private"].includes(String(visibility)),
      422,
      "INVALID_VISIBILITY",
      "可见性无效",
    );
    const lat = value(
        "latitude",
        old?.latitude === null ? null : Number(old?.latitude),
        null,
      ),
      lng = value(
        "longitude",
        old?.longitude === null ? null : Number(old?.longitude),
        null,
      );
    requireValue(
      (lat === null && lng === null) ||
        (typeof lat === "number" &&
          typeof lng === "number" &&
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180),
      422,
      "INVALID_COORDINATES",
      "经纬度需同时填写，使用 WGS84",
    );
    if (
      old &&
      (locationName !== old.location_name ||
        address !== old.address ||
        lat !== (old.latitude === null ? null : Number(old.latitude)) ||
        lng !== (old.longitude === null ? null : Number(old.longitude)) ||
        visibility !== old.visibility)
    ) {
      const exists = await tx.query(
        "SELECT b.id FROM activity_bookings b JOIN activity_slots s ON s.id=b.slot_id WHERE s.activity_id=? LIMIT 1",
        [old.id],
      );
      requireValue(
        !exists.length,
        409,
        "BOOKED_LOCATION_IMMUTABLE",
        "已有预约记录，地点及可见性变更请关闭原活动并新建",
      );
    }
    const cover = value("coverAssetId", old?.cover_asset_id, null);
    await this.cover(tx, ctx.userId, cover);
    const activityId = id || randomUUID();
    if (old)
      await tx.execute(
        "UPDATE activities SET title=?,category=?,description=?,cover_asset_id=?,location_name=?,address=?,latitude=?,longitude=?,visibility=?,version=version+1 WHERE id=?",
        [
          title,
          category,
          description,
          cover as string | null,
          locationName,
          address,
          lat as number | null,
          lng as number | null,
          visibility as string,
          activityId,
        ],
      );
    else
      await tx.execute(
        "INSERT INTO activities (id,organizer_user_id,title,category,description,cover_asset_id,location_name,address,latitude,longitude,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
          activityId,
          ctx.userId,
          title,
          category,
          description,
          cover as string | null,
          locationName,
          address,
          lat as number | null,
          lng as number | null,
          visibility as string,
        ],
      );
    const updated = await activity(tx, activityId);
    await new LocalAudit().record(
      tx,
      ctx,
      old ? "activity.updated" : "activity.created",
      "activities",
      activityId,
      { before: old ? activityDto(old) : null, after: activityDto(updated) },
    );
    return activityDto(updated);
  }
  async publish(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) {
    await this.assertAdmin(tx, ctx.userId);
    exactBody(body, ["version"]);
    const a = await activity(tx, id, true);
    version(a.version, body.version);
    requireValue(
      a.status !== "archived",
      409,
      "ACTIVITY_ARCHIVED",
      "归档活动不能重新发布",
    );
    if (a.status === "published") return activityDto(a);
    textValue(a.title, 100);
    textValue(a.description, 10000);
    textValue(a.location_name, 150);
    textValue(a.address, 1000);
    await this.cover(tx, ctx.userId, a.cover_asset_id);
    await tx.execute(
      "UPDATE activities SET status='published',version=version+1 WHERE id=?",
      [id],
    );
    await new LocalAudit().record(
      tx,
      ctx,
      "activity.published",
      "activities",
      id,
      { version: a.version + 1 },
    );
    return activityDto(await activity(tx, id));
  }
  async saveSlot(
    tx: SqlTx,
    ctx: CommandContext,
    activityId: string,
    body: Record<string, unknown>,
    slotId?: string,
  ) {
    await this.assertAdmin(tx, ctx.userId);
    exactBody(
      body,
      slotId
        ? [
            "version",
            "startAt",
            "endAt",
            "capacity",
            "bookingOpenAt",
            "bookingCloseAt",
            "cancelBeforeAt",
          ]
        : [
            "startAt",
            "endAt",
            "capacity",
            "bookingOpenAt",
            "bookingCloseAt",
            "cancelBeforeAt",
          ],
    );
    const a = await activity(tx, activityId, true);
    requireValue(
      a.status !== "archived",
      409,
      "ACTIVITY_ARCHIVED",
      "归档活动不能创建或修改场次",
    );
    const old = slotId ? await slot(tx, slotId, true) : null;
    if (old) {
      requireValue(
        old.activity_id === activityId,
        404,
        "SLOT_NOT_FOUND",
        "场次不存在",
      );
      version(old.version, body.version);
      requireValue(old.status === "open", 409, "SLOT_CLOSED", "场次已关闭");
    }
    const time = (key: string, oldValue?: string) =>
      instant(
        body[key] === undefined && oldValue ? asInstant(oldValue) : body[key],
      );
    const start = time("startAt", old?.start_at),
      end = time("endAt", old?.end_at),
      open = time("bookingOpenAt", old?.booking_open_at),
      close = time("bookingCloseAt", old?.booking_close_at),
      cancel = time("cancelBeforeAt", old?.cancel_before_at),
      capacity = int(
        body.capacity === undefined ? old?.capacity : body.capacity,
        1,
        10000,
      );
    requireValue(
      start < end && open < close && close <= start && cancel <= start,
      422,
      "INVALID_TIME_WINDOW",
      "请检查开始、结束、报名和取消时间顺序",
    );
    requireValue(
      end > ctx.operationNow,
      422,
      "SLOT_ENDED",
      "不能创建或修改已经结束的场次",
    );
    requireValue(
      capacity >= (old?.booked_count || 0),
      409,
      "CAPACITY_BELOW_OCCUPIED",
      "容量不能小于已占名额",
    );
    if (
      old &&
      (start !== asInstant(old.start_at) || end !== asInstant(old.end_at))
    ) {
      const bookings = await tx.query(
        "SELECT id FROM activity_bookings WHERE slot_id=? LIMIT 1",
        [old.id],
      );
      requireValue(
        !bookings.length,
        409,
        "BOOKED_TIME_IMMUTABLE",
        "已有预约记录，请取消原场次后创建新场次，不能静默改约",
      );
    }
    const id = slotId || randomUUID(),
      values = [
        new Date(start),
        new Date(end),
        capacity,
        new Date(open),
        new Date(close),
        new Date(cancel),
      ];
    if (old)
      await tx.execute(
        "UPDATE activity_slots SET start_at=?,end_at=?,capacity=?,booking_open_at=?,booking_close_at=?,cancel_before_at=?,version=version+1 WHERE id=?",
        [...values, id],
      );
    else
      await tx.execute(
        "INSERT INTO activity_slots (id,activity_id,start_at,end_at,capacity,booking_open_at,booking_close_at,cancel_before_at) VALUES (?,?,?,?,?,?,?,?)",
        [id, activityId, ...values],
      );
    const updated = await slot(tx, id);
    await new LocalAudit().record(
      tx,
      ctx,
      old ? "slot.updated" : "slot.created",
      "activity_slots",
      id,
      { before: old ? slotDto(old) : null, after: slotDto(updated) },
    );
    return slotDto(updated);
  }
  async lockSlot(tx: SqlTx, id: string) {
    const located = await slot(tx, id);
    const a = await activity(tx, located.activity_id, true),
      s = await slot(tx, id, true);
    requireValue(
      s.activity_id === a.id,
      409,
      "RESOURCE_CHANGED",
      "场次关联已变化",
    );
    return { a, s };
  }
  private async event(
    tx: SqlTx,
    b: BookingRow,
    actor: string | null,
    action: string,
    now: string,
    reason: string | null,
  ) {
    const id = randomUUID();
    await tx.execute(
      "INSERT INTO booking_events (id,booking_id,actor_user_id,action,reason,occurred_at) VALUES (?,?,?,?,?,?)",
      [id, b.id, actor, action, reason, new Date(now)],
    );
    this.checkpoint?.("after_event");
    return id;
  }
  private async notification(
    tx: SqlTx,
    b: BookingRow,
    eventId: string,
    confirmed: boolean,
  ) {
    const eventType = confirmed
      ? "activity.booking.confirmed.v1"
      : "activity.booking.canceled.v1";
    await new LocalOutbox().enqueueInTransaction(tx, {
      eventType,
      aggregateType: "activity_booking",
      aggregateId: b.id,
      eventKey: `${eventType}:${eventId}`,
      schemaVersion: 1,
      payload: {
        bookingId: b.id,
        bookingEventId: eventId,
        slotId: b.slot_id,
        userId: b.user_id,
      },
    });
  }
  async book(tx: SqlTx, ctx: CommandContext, body: Record<string, unknown>) {
    exactBody(body, ["slotId", "participantVisibility"]);
    const slotId = uuid(body.slotId),
      visibility = body.participantVisibility ?? "hidden";
    requireValue(
      visibility === "hidden" || visibility === "public",
      422,
      "INVALID_VISIBILITY",
      "参与身份只能隐藏或公开",
    );
    const { a, s } = await this.lockSlot(tx, slotId);
    const [prior] = await tx.query<BookingRow>(
      "SELECT * FROM activity_bookings WHERE user_id=? AND slot_id=? FOR UPDATE",
      [ctx.userId, slotId],
    );
    if (prior?.status === "confirmed") return bookingDto(prior, s);
    requireValue(
      !prior || prior.status === "canceled",
      409,
      "BOOKING_FINAL",
      "已签到或未到场记录不能重新预约",
    );
    publicActivity(a);
    requireValue(s.status === "open", 409, "SLOT_CLOSED", "场次已关闭");
    requireValue(
      ctx.operationNow >= asInstant(s.booking_open_at) &&
        ctx.operationNow < asInstant(s.booking_close_at),
      409,
      "BOOKING_WINDOW_CLOSED",
      "当前不在报名时间内",
    );
    const overlap = await tx.query(
      "SELECT b.id FROM activity_bookings b JOIN activity_slots s ON s.id=b.slot_id WHERE b.user_id=? AND b.status='confirmed' AND s.start_at<? AND s.end_at>? LIMIT 1",
      [
        ctx.userId,
        new Date(asInstant(s.end_at)),
        new Date(asInstant(s.start_at)),
      ],
    );
    requireValue(
      !overlap.length,
      409,
      "BOOKING_TIME_CONFLICT",
      "你已有时间重叠的预约",
    );
    const seat = await tx.execute(
      "UPDATE activity_slots SET booked_count=booked_count+1,version=version+1 WHERE id=? AND booked_count<capacity",
      [slotId],
    );
    requireValue(seat.affectedRows === 1, 409, "SLOT_FULL", "本场名额已满");
    this.checkpoint?.("after_seat");
    const id = prior?.id || randomUUID(),
      snapA = JSON.stringify(activitySnapshot(a)),
      snapS = JSON.stringify(slotSnapshot(s));
    if (prior)
      await tx.execute(
        "UPDATE activity_bookings SET status='confirmed',participant_visibility=?,booked_at=?,canceled_at=NULL,cancel_reason=NULL,activity_snapshot=?,slot_snapshot=?,version=version+1 WHERE id=?",
        [visibility, new Date(ctx.operationNow), snapA, snapS, id],
      );
    else
      await tx.execute(
        "INSERT INTO activity_bookings (id,user_id,slot_id,participant_visibility,booked_at,activity_snapshot,slot_snapshot) VALUES (?,?,?,?,?,?,?)",
        [
          id,
          ctx.userId,
          slotId,
          visibility,
          new Date(ctx.operationNow),
          snapA,
          snapS,
        ],
      );
    this.checkpoint?.("after_booking");
    const [b] = await tx.query<BookingRow>(
      "SELECT * FROM activity_bookings WHERE id=?",
      [id],
    );
    const eventId = await this.event(
      tx,
      b,
      ctx.userId,
      prior ? "rebook" : "create",
      ctx.operationNow,
      JSON.stringify({
        activitySnapshot: activitySnapshot(a),
        slotSnapshot: slotSnapshot(s),
      }),
    );
    await this.notification(tx, b, eventId, true);
    return bookingDto(b, await slot(tx, slotId));
  }
  async booking(tx: SqlTx, id: string, owner?: string) {
    const [b] = await tx.query<BookingRow>(
      "SELECT * FROM activity_bookings WHERE id=?" +
        (owner ? " AND user_id=?" : ""),
      owner ? [uuid(id), owner] : [uuid(id)],
    );
    requireValue(b, 404, "BOOKING_NOT_FOUND", "预约不存在");
    return b;
  }
  async cancelBooking(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) {
    exactBody(body, ["version", "reason"]);
    int(body.version);
    const reason =
      body.reason === undefined ? null : textValue(body.reason, 200, 0);
    const located = await this.booking(tx, id, ctx.userId),
      { s } = await this.lockSlot(tx, located.slot_id);
    const [b] = await tx.query<BookingRow>(
      "SELECT * FROM activity_bookings WHERE id=? AND user_id=? FOR UPDATE",
      [id, ctx.userId],
    );
    requireValue(
      b && b.slot_id === s.id,
      404,
      "BOOKING_NOT_FOUND",
      "预约不存在",
    );
    if (b.status === "canceled") return bookingDto(b, s);
    version(b.version, body.version);
    requireValue(
      b.status === "confirmed",
      409,
      "BOOKING_FINAL",
      "只有待参加的预约可以取消",
    );
    requireValue(
      ctx.operationNow < asInstant(s.cancel_before_at),
      409,
      "CANCEL_DEADLINE_PASSED",
      "已过取消截止时间",
    );
    requireValue(
      ctx.operationNow >= asInstant(b.booked_at),
      409,
      "CLOCK_BEFORE_BOOKING",
      "测试时钟早于预约时间，请先恢复时钟",
    );
    await tx.execute(
      "UPDATE activity_bookings SET status='canceled',canceled_at=?,cancel_reason=?,version=version+1 WHERE id=?",
      [new Date(ctx.operationNow), reason, id],
    );
    const changed = await tx.execute(
      "UPDATE activity_slots SET booked_count=booked_count-1,version=version+1 WHERE id=? AND booked_count>0",
      [s.id],
    );
    requireValue(
      changed.affectedRows === 1,
      409,
      "SEAT_COUNT_MISMATCH",
      "场次计数异常",
    );
    const eventId = await this.event(
      tx,
      b,
      ctx.userId,
      "cancel",
      ctx.operationNow,
      reason,
    );
    await this.notification(tx, b, eventId, false);
    return bookingDto(await this.booking(tx, id), await slot(tx, s.id));
  }
  private async cancelLocked(
    tx: SqlTx,
    ctx: CommandContext,
    s: SlotRow,
    reason: string,
  ) {
    if (s.status === "canceled") return slotDto(s);
    requireValue(
      s.status === "open",
      409,
      "SLOT_COMPLETED",
      "已结束结算场次不可取消",
    );
    const bookings = await tx.query<BookingRow>(
      "SELECT * FROM activity_bookings WHERE slot_id=? AND status='confirmed' ORDER BY id FOR UPDATE",
      [s.id],
    );
    for (const b of bookings) {
      requireValue(
        ctx.operationNow >= asInstant(b.booked_at),
        409,
        "CLOCK_BEFORE_BOOKING",
        "测试时钟早于预约时间，请先恢复时钟",
      );
      await tx.execute(
        "UPDATE activity_bookings SET status='canceled',canceled_at=?,cancel_reason=?,version=version+1 WHERE id=?",
        [new Date(ctx.operationNow), reason, b.id],
      );
      await this.event(
        tx,
        b,
        ctx.userId,
        "host_cancel",
        ctx.operationNow,
        reason,
      );
    }
    await tx.execute(
      "UPDATE activity_slots SET status='canceled',booked_count=booked_count-?,version=version+1 WHERE id=?",
      [bookings.length, s.id],
    );
    const updated = await slot(tx, s.id);
    await new LocalOutbox().enqueueInTransaction(tx, {
      eventType: "activity.slot.canceled.v1",
      aggregateType: "activity_slot",
      aggregateId: s.id,
      eventKey: `activity.slot.canceled.v1:${s.id}:${updated.version}`,
      schemaVersion: 1,
      payload: {
        slotId: s.id,
        slotVersion: updated.version,
        actorUserId: ctx.userId,
      },
    });
    await new LocalAudit().record(
      tx,
      ctx,
      "slot.canceled",
      "activity_slots",
      s.id,
      { reason, canceledBookings: bookings.length },
    );
    return slotDto(updated);
  }
  async cancelSlot(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) {
    await this.assertAdmin(tx, ctx.userId);
    exactBody(body, ["version", "reason"]);
    int(body.version);
    const reason = textValue(body.reason, 200),
      { s } = await this.lockSlot(tx, id);
    if (s.status === "canceled") return slotDto(s);
    version(s.version, body.version);
    return this.cancelLocked(tx, ctx, s, reason);
  }
  async archive(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) {
    await this.assertAdmin(tx, ctx.userId);
    exactBody(body, ["version", "reason"]);
    int(body.version);
    const reason = textValue(body.reason, 200),
      a = await activity(tx, id, true);
    if (a.status === "archived") return activityDto(a);
    version(a.version, body.version);
    return this.archiveLocked(tx, ctx, a, reason);
  }
  async archiveLocked(
    tx: SqlTx,
    ctx: CommandContext,
    a: ActivityRow,
    reason: string,
  ) {
    if (a.status === "archived") return activityDto(a);
    await tx.execute(
      "UPDATE activities SET status='archived',version=version+1 WHERE id=?",
      [a.id],
    );
    const slots = await tx.query<SlotRow>(
      "SELECT * FROM activity_slots WHERE activity_id=? AND status='open' ORDER BY id FOR UPDATE",
      [a.id],
    );
    for (const s of slots) {
      if (asInstant(s.end_at) < ctx.operationNow)
        await this.settleLocked(tx, s, ctx.operationNow);
      else await this.cancelLocked(tx, ctx, s, reason);
    }
    await new LocalAudit().record(
      tx,
      ctx,
      "activity.archived",
      "activities",
      a.id,
      { reason, closedSlots: slots.length },
    );
    return activityDto(await activity(tx, a.id));
  }
  async checkin(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) {
    await this.assertAdmin(tx, ctx.userId);
    exactBody(body, ["version"]);
    int(body.version);
    const located = await this.booking(tx, id),
      { s } = await this.lockSlot(tx, located.slot_id);
    const [b] = await tx.query<BookingRow>(
      "SELECT * FROM activity_bookings WHERE id=? FOR UPDATE",
      [id],
    );
    if (b.status === "attended") return bookingDto(b, s);
    version(b.version, body.version);
    requireValue(
      s.status === "open" && b.status === "confirmed",
      409,
      "BOOKING_NOT_CHECKINABLE",
      "场次或预约当前不可签到",
    );
    requireValue(
      Date.parse(ctx.operationNow) >=
        Date.parse(asInstant(s.start_at)) - 30 * 60000 &&
        ctx.operationNow <= asInstant(s.end_at),
      409,
      "CHECKIN_WINDOW_CLOSED",
      "签到窗口为开始前 30 分钟至结束时刻",
    );
    await tx.execute(
      "UPDATE activity_bookings SET status='attended',version=version+1 WHERE id=?",
      [id],
    );
    await this.event(tx, b, ctx.userId, "checkin", ctx.operationNow, null);
    await new LocalAudit().record(
      tx,
      ctx,
      "booking.checked_in",
      "activity_bookings",
      id,
      {},
    );
    return bookingDto(await this.booking(tx, id), s);
  }
  async settleLocked(tx: SqlTx, s: SlotRow, now: string) {
    if (s.status !== "open" || asInstant(s.end_at) >= now) return 0;
    const bookings = await tx.query<BookingRow>(
      "SELECT * FROM activity_bookings WHERE slot_id=? AND status='confirmed' ORDER BY id FOR UPDATE",
      [s.id],
    );
    for (const b of bookings) {
      await tx.execute(
        "UPDATE activity_bookings SET status='no_show',version=version+1 WHERE id=?",
        [b.id],
      );
      await this.event(tx, b, null, "no_show", now, "系统结束结算");
    }
    await tx.execute(
      "UPDATE activity_slots SET status='completed',version=version+1 WHERE id=?",
      [s.id],
    );
    return bookings.length;
  }
  async settle(tx: SqlTx, id: string, now: string) {
    const { s } = await this.lockSlot(tx, id);
    return this.settleLocked(tx, s, now);
  }
}
