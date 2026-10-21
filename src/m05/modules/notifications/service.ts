import { randomUUID } from "node:crypto";
import type {
  SqlTx,
  CommandContext,
  DbParam,
} from "../../../../contracts/shared_types.js";
import type {
  NotificationsPort,
  NotificationInput,
} from "../../../../contracts/m05-notifications.js";
import { exactBody, requireValue } from "../../common/errors.js";
import { LocalAudit, LocalOutbox } from "../../common/ports.js";
import {
  uuid,
  int,
  textValue,
  version,
  asInstant,
  Paging,
  queryKeys,
} from "../activities/model.js";
export const actionPath = (v: unknown) => {
  requireValue(
    typeof v === "string" &&
      /^\/(messages|points|rewards|redemptions|activities|bookings|community|profile)(\/[0-9a-f-]{36})?$/.test(
        v,
      ) &&
      v.length <= 200,
    422,
    "INVALID_ACTION_PATH",
    "仅支持 M05 内部页面，不接受外链",
  );
  if (v.split("/")[2]) uuid(v.split("/")[2]);
  return v;
};
export function recipients(v: unknown): string[] {
  requireValue(
    Array.isArray(v) && v.length >= 1 && v.length <= 100,
    422,
    "INVALID_RECIPIENTS",
    "请指定 1—100 名接收用户",
  );
  const ids = v.map(uuid);
  requireValue(
    new Set(ids).size === ids.length,
    422,
    "DUPLICATE_RECIPIENT",
    "接收用户不能重复",
  );
  return ids.sort();
}
export class LocalNotifications implements NotificationsPort {
  readonly mode = "local_in_app" as const;
  constructor(private beforeCreate?: (userId: string) => void) {}
  async createInTransaction(tx: SqlTx, i: NotificationInput) {
    const [old] = await tx.query<{
      id: string;
      type: string;
      title: string;
      body: string;
      action_path: string;
    }>(
      "SELECT id,type,title,body,action_path FROM notifications WHERE user_id=? AND event_key=?",
      [i.userId, i.eventKey],
    );
    if (old) {
      requireValue(
        old.type === i.type &&
          old.title === i.title &&
          old.body === i.body &&
          old.action_path === i.actionPath,
        409,
        "NOTIFICATION_KEY_CONFLICT",
        "通知去重键冲突",
      );
      return { id: old.id };
    }
    this.beforeCreate?.(i.userId);
    const id = randomUUID();
    await tx.execute(
      "INSERT INTO notifications(id,user_id,type,title,body,action_path,event_key) VALUES (?,?,?,?,?,?,?)",
      [
        id,
        i.userId,
        i.type,
        i.title,
        i.body,
        actionPath(i.actionPath),
        i.eventKey,
      ],
    );
    return { id };
  }
}
export type Campaign = {
  id: string;
  created_by: string;
  title: string;
  body: string;
  action_path: string;
  recipient_ids: string[];
  status: string;
  version: number;
  created_at: string;
  sent_at: string | null;
};
export async function campaign(tx: SqlTx, id: string, lock = false) {
  const [r] = await tx.query<Campaign>(
    "SELECT * FROM m05_message_campaigns WHERE id=?" +
      (lock ? " FOR UPDATE" : ""),
    [uuid(id)],
  );
  requireValue(r, 404, "CAMPAIGN_NOT_FOUND", "消息批次不存在");
  return r;
}
export const campaignDto = (r: Campaign) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  actionPath: r.action_path,
  recipientUserIds: r.recipient_ids,
  status: r.status,
  version: r.version,
  createdAt: asInstant(r.created_at),
  sentAt: r.sent_at ? asInstant(r.sent_at) : null,
});
export class MessagesService {
  readonly pages: Paging;
  constructor(
    secret: string,
    readonly port: NotificationsPort | null,
  ) {
    this.pages = new Paging(secret);
  }
  async admin(tx: SqlTx, id: string) {
    requireValue(
      (
        await tx.query("SELECT id FROM user_roles WHERE user_id=? AND role=?", [
          id,
          "admin",
        ])
      ).length,
      403,
      "ADMIN_REQUIRED",
      "需要管理员权限",
    );
  }
  async save(
    tx: SqlTx,
    ctx: CommandContext,
    body: Record<string, unknown>,
    id?: string,
  ) {
    await this.admin(tx, ctx.userId);
    exactBody(body, [
      "title",
      "body",
      "recipientUserIds",
      "link",
      ...(id ? ["version"] : []),
    ]);
    const old = id ? await campaign(tx, id, true) : null;
    if (old) {
      version(old.version, body.version);
      requireValue(
        old.status === "draft",
        409,
        "CAMPAIGN_FROZEN",
        "已提交的消息不能修改",
      );
    }
    const ids = recipients(body.recipientUserIds ?? old?.recipient_ids);
    for (const uid of ids) {
      const [u] = await tx.query<{ status: string; deleted_at: string | null }>(
        "SELECT status,deleted_at FROM users WHERE id=?",
        [uid],
      );
      requireValue(
        u && u.status === "active" && !u.deleted_at,
        422,
        "RECIPIENT_UNAVAILABLE",
        "接收用户不存在或已停用",
      );
    }
    const title = textValue(body.title ?? old?.title, 100),
      content = textValue(body.body ?? old?.body, 500),
      path = actionPath(body.link ?? old?.action_path ?? "/messages"),
      cid = id || randomUUID();
    if (old) {
      int(old.version + 1);
      await tx.execute(
        "UPDATE m05_message_campaigns SET title=?,body=?,action_path=?,recipient_ids=?,version=version+1 WHERE id=?",
        [title, content, path, JSON.stringify(ids), cid],
      );
    } else
      await tx.execute(
        "INSERT INTO m05_message_campaigns(id,created_by,title,body,action_path,recipient_ids) VALUES (?,?,?,?,?,?)",
        [cid, ctx.userId, title, content, path, JSON.stringify(ids)],
      );
    await new LocalAudit().record(
      tx,
      ctx,
      old ? "message.updated" : "message.created",
      "m05_message_campaigns",
      cid,
      { recipientCount: ids.length, title },
    );
    return campaignDto(await campaign(tx, cid));
  }
  async send(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
    retry = false,
  ) {
    await this.admin(tx, ctx.userId);
    requireValue(
      this.port,
      503,
      "NOTIFICATIONS_NOT_CONFIGURED",
      "通知适配器未接入，未发送",
    );
    exactBody(body, ["version"]);
    const c = await campaign(tx, id, true);
    version(c.version, body.version);
    int(c.version + 1);
    requireValue(
      retry ? c.status === "partial_failed" : c.status === "draft",
      409,
      "CAMPAIGN_STATE_CONFLICT",
      retry ? "只有失败项可重试" : "消息已提交或不可发送",
    );
    if (retry) {
      await tx.execute(
        "UPDATE m05_message_recipients SET status='pending',last_error_code=NULL,version=version+1 WHERE campaign_id=? AND status='failed'",
        [id],
      );
    } else {
      for (const uid of c.recipient_ids)
        await tx.execute(
          "INSERT INTO m05_message_recipients(id,campaign_id,user_id) VALUES (?,?,?)",
          [randomUUID(), id, uid],
        );
    }
    await tx.execute(
      "UPDATE m05_message_campaigns SET status='queued',sent_at=COALESCE(sent_at,?),version=version+1 WHERE id=?",
      [new Date(ctx.operationNow), id],
    );
    const payload = { campaignId: id, campaignVersion: c.version + 1 };
    await new LocalOutbox().enqueueInTransaction(tx, {eventType:"m05.message.campaign.requested.v1",aggregateType:"message_campaign",aggregateId:id,eventKey:`m05.message.campaign.requested.v1:${id}:${c.version+1}`,schemaVersion:1,payload});
    await new LocalAudit().record(
      tx,
      ctx,
      retry ? "message.retry" : "message.send",
      "m05_message_campaigns",
      id,
      { recipientCount: c.recipient_ids.length, version: c.version + 1 },
    );
    return { ...campaignDto(await campaign(tx, id)), channel: this.port.mode };
  }
  async list(tx: SqlTx, actor: string, q: Record<string, unknown>) {
    queryKeys(q, ["status", "cursor", "limit"]);
    const where = ["1=1"],
      values: DbParam[] = [];
    if (q.status !== undefined) {
      requireValue(
        ["draft", "queued", "sending", "completed", "partial_failed"].includes(
          String(q.status),
        ),
        422,
        "INVALID_STATUS",
        "批次状态无效",
      );
      where.push("status=?");
      values.push(String(q.status));
    }
    const pg = this.pages.make(q, {
        type: "campaigns",
        actor,
        status: q.status || null,
      }),
      cur = pg.where("created_at");
    const rows = await tx.query<Campaign>(
        `SELECT * FROM m05_message_campaigns WHERE ${where.join(" AND ")}${cur.sql} ORDER BY created_at DESC,id DESC LIMIT ${pg.limit + 1}`,
        [...values, ...cur.values],
      ),
      p = pg.page(rows, (r) => r.created_at);
    return {
      ...p,
      items: await Promise.all(
        p.items.map(async (r) => ({
          ...campaignDto(r),
          counts: await this.counts(tx, r.id),
        })),
      ),
    };
  }
  async counts(tx: SqlTx, id: string) {
    const rows = await tx.query<{ status: string; n: number }>(
      "SELECT status,COUNT(*) n FROM m05_message_recipients WHERE campaign_id=? GROUP BY status",
      [id],
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }
  async detail(tx: SqlTx, id: string) {
    const r = await campaign(tx, id);
    return {
      ...campaignDto(r),
      counts: await this.counts(tx, id),
      channel: this.port?.mode || "unavailable",
      webPush: false,
      appPush: false,
    };
  }
  async recipientList(
    tx: SqlTx,
    id: string,
    actor: string,
    q: Record<string, unknown>,
  ) {
    await campaign(tx, id);
    queryKeys(q, ["cursor", "limit"]);
    const pg = this.pages.make(q, { type: "recipients", id, actor }),
      cur = pg.where("r.created_at", "r.id");
    const rows = await tx.query<{
        id: string;
        created_at: string;
        user_id: string;
        nickname: string;
        notification_id: string | null;
        status: string;
        attempts: number;
        last_error_code: string | null;
        read_at: string | null;
      }>(
        `SELECT r.*,u.nickname,n.read_at FROM m05_message_recipients r JOIN users u ON u.id=r.user_id LEFT JOIN notifications n ON n.id=r.notification_id WHERE r.campaign_id=?${cur.sql} ORDER BY r.created_at DESC,r.id DESC LIMIT ${pg.limit + 1}`,
        [id, ...cur.values],
      ),
      p = pg.page(rows, (r) => r.created_at);
    return {
      ...p,
      items: await Promise.all(
        p.items.map(async (r) => ({
          id: r.id,
          userId: r.user_id,
          nickname: r.nickname,
          notificationId: r.notification_id,
          status: r.status,
          attempts: r.attempts,
          errorCode: r.last_error_code,
          readAt: r.read_at ? asInstant(r.read_at) : null,
          channel: this.port?.mode || "unavailable",
          deliveries: r.notification_id
            ? await tx.query(
                "SELECT status,attempts,last_error_code FROM notification_deliveries WHERE notification_id=? AND user_id=?",
                [r.notification_id, r.user_id],
              )
            : [],
        })),
      ),
    };
  }
  async inbox(tx: SqlTx, actor: string, q: Record<string, unknown>) {
    queryKeys(q, ["unreadOnly", "cursor", "limit"]);
    requireValue(
      q.unreadOnly === undefined ||
        ["true", "false"].includes(String(q.unreadOnly)),
      422,
      "INVALID_FILTER",
      "未读筛选无效",
    );
    const unread = q.unreadOnly === "true",
      pg = this.pages.make(q, { type: "inbox", actor, unread }),
      cur = pg.where("created_at");
    const rows = await tx.query<{
        id: string;
        type: string;
        title: string;
        body: string;
        action_path: string;
        read_at: string | null;
        created_at: string;
      }>(
        `SELECT id,type,title,body,action_path,read_at,created_at FROM notifications WHERE user_id=? ${unread ? "AND read_at IS NULL" : ""}${cur.sql} ORDER BY created_at DESC,id DESC LIMIT ${pg.limit + 1}`,
        [actor, ...cur.values],
      ),
      p = pg.page(rows, (r) => r.created_at);
    const [n] = await tx.query<{ n: number }>(
      "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL",
      [actor],
    );
    return {
      ...p,
      unreadCount: Number(n.n),
      channel: this.port?.mode || "in_app",
      items: p.items.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        action: { path: r.action_path },
        readAt: r.read_at ? asInstant(r.read_at) : null,
        createdAt: asInstant(r.created_at),
      })),
    };
  }
  async read(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) {
    exactBody(body, []);
    const [r] = await tx.query<{ id: string; read_at: string | null }>(
      "SELECT id,read_at FROM notifications WHERE id=? AND user_id=? FOR UPDATE",
      [uuid(id), ctx.userId],
    );
    requireValue(r, 404, "NOTIFICATION_NOT_FOUND", "消息不存在");
    if (!r.read_at)
      await tx.execute("UPDATE notifications SET read_at=? WHERE id=?", [
        new Date(ctx.operationNow),
        id,
      ]);
    return { id, readAt: r.read_at ? asInstant(r.read_at) : ctx.operationNow };
  }
  async users(tx: SqlTx, q: Record<string, unknown>, actor: string) {
    queryKeys(q, ["q", "cursor", "limit"]);
    const name = q.q === undefined ? "" : textValue(q.q, 30, 0),
      pg = this.pages.make(q, { type: "recipients_picker", actor, name }),
      cur = pg.where("created_at");
    const rows = await tx.query<{
        id: string;
        nickname: string;
        created_at: string;
      }>(
        `SELECT id,nickname,created_at FROM users WHERE status='active' AND deleted_at IS NULL AND nickname LIKE ?${cur.sql} ORDER BY created_at DESC,id DESC LIMIT ${pg.limit + 1}`,
        ["%" + name + "%", ...cur.values],
      ),
      p = pg.page(rows, (r) => r.created_at);
    return {
      ...p,
      items: p.items.map((r) => ({ id: r.id, nickname: r.nickname })),
    };
  }
}
