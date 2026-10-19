import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { rows } from "../../common/database.js";
import { reject } from "../../common/error.js";
import { encrypt, digest, equal } from "../identity/crypto.js";
import { safeAction, type Context, isUuid } from "../../common/foundation.js";
const allowed = [
  "training_reminder",
  "booking_confirmed",
  "booking_canceled",
  "activity_canceled",
  "redemption_result",
];
export class NotificationService {
  capabilities() {
    return { inApp: true, webPush: false, appPush: false };
  }
  async subscribe(_c: PoolConnection, _ctx: Context, _input: unknown) {
    reject(503, "PUSH_NOT_CONFIGURED", "Web Push 尚未配置，当前支持站内通知");
  }
  async unsubscribe(c: PoolConnection, ctx: Context, id: string) {
    if (!isUuid(id)) reject(422, "INVALID_ID", "订阅标识无效");
    await c.execute(
      "UPDATE notification_subscriptions SET enabled=0,endpoint_ciphertext=NULL,endpoint_hash=NULL,keys_ciphertext=NULL,token_ciphertext=NULL,token_hash=NULL WHERE id=? AND user_id=?",
      [id, ctx.userId],
    );
    return null;
  }
  async createInTransaction(
    c: PoolConnection,
    ctx: Context,
    intent: {
      type: string;
      title: string;
      body: string;
      actionPath: string;
      eventKey: string;
    },
  ) {
    if (
      !allowed.includes(intent.type) ||
      !intent.title.trim() ||
      intent.title.length > 100 ||
      !intent.body.trim() ||
      intent.body.length > 500 ||
      !/^[A-Za-z0-9_.:@/-]{1,200}$/.test(intent.eventKey)
    )
      reject(422, "INVALID_NOTIFICATION", "通知内容无效");
    safeAction(intent.actionPath);
    await c.execute(
      "INSERT INTO notifications(id,user_id,type,title,body,action_path,event_key)VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",
      [
        randomUUID(),
        ctx.userId,
        intent.type,
        intent.title,
        intent.body,
        intent.actionPath,
        intent.eventKey,
      ],
    );
    const notification = (
      await rows(
        c,
        "SELECT id FROM notifications WHERE user_id=? AND event_key=?",
        [ctx.userId, intent.eventKey],
      )
    )[0];
    // External channels deliberately disabled until a provider and device-proof flow are configured.
    return { id: notification.id };
  }
  async list(c: PoolConnection, userId: string, params: URLSearchParams) {
    for (const key of params.keys())
      if (!["limit", "cursor", "unreadOnly"].includes(key))
        reject(422, "INVALID_QUERY", "查询参数无效");
    const n = Number(params.get("limit") ?? 20);
    if (
      !Number.isInteger(n) ||
      n < 1 ||
      n > 100 ||
      !["true", "false", null].includes(params.get("unreadOnly"))
    )
      reject(422, "INVALID_QUERY", "分页参数无效");
    const unread = params.get("unreadOnly") === "true";
    let tail = "";
    let values: any[] = [userId];
    if (params.get("cursor")) {
      try {
        const [value, sig] = params.get("cursor")!.split(".");
        if (
          !equal(sig, digest("cursor:" + userId + ":" + unread + ":" + value))
        )
          throw Error();
        const cursor = JSON.parse(Buffer.from(value, "base64url").toString());
        if (!isUuid(cursor.id) || typeof cursor.time !== "string")
          throw Error();
        tail = " AND (created_at<? OR (created_at=? AND id<?))";
        values.push(cursor.time, cursor.time, cursor.id);
      } catch {
        reject(422, "INVALID_CURSOR", "分页游标无效");
      }
    }
    const records = await rows(
      c,
      "SELECT * FROM notifications WHERE user_id=?" +
        (unread ? " AND read_at IS NULL" : "") +
        tail +
        " ORDER BY created_at DESC,id DESC LIMIT " +
        (n + 1),
      values,
    );
    const page = records.slice(0, n);
    let nextCursor = null;
    if (records.length > n) {
      const last = page.at(-1)!;
      const value = Buffer.from(
        JSON.stringify({ time: last.created_at, id: last.id }),
      ).toString("base64url");
      nextCursor =
        value + "." + digest("cursor:" + userId + ":" + unread + ":" + value);
    }
    return {
      items: page.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        action: { path: r.action_path },
        readAt: r.read_at ? r.read_at.replace(" ", "T") + "Z" : null,
        createdAt: r.created_at.replace(" ", "T") + "Z",
      })),
      nextCursor,
    };
  }
  async read(c: PoolConnection, userId: string, id: string) {
    if (!isUuid(id)) reject(404, "NOT_FOUND", "通知不存在");
    const r = (
      await rows(c, "SELECT id FROM notifications WHERE id=? AND user_id=?", [
        id,
        userId,
      ])
    )[0];
    if (!r) reject(404, "NOT_FOUND", "通知不存在");
    await c.execute(
      "UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE id=?",
      [id],
    );
    const updated = (
      await rows(c, "SELECT read_at FROM notifications WHERE id=?", [id])
    )[0];
    return { id, readAt: updated.read_at.replace(" ", "T") + "Z" };
  }
}
