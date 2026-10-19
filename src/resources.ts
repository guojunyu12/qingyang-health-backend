import type { Request, Response } from "express";
import { IdentityService } from "./modules/identity/service.js";
import { MediaService } from "./modules/uploads/service.js";
import { NotificationService } from "./modules/notifications/service.js";
import { transaction } from "./common/database.js";
import { equal } from "./modules/identity/crypto.js";
import { idempotent, audit } from "./common/foundation.js";
import { reject } from "./common/error.js";
const media = new MediaService();
const notices = new NotificationService();
export async function resources(
  req: Request,
  res: Response,
  identity: IdentityService,
): Promise<{ status: number; data?: unknown; raw?: boolean } | null> {
  const p = req.path;
  const method = req.method;
  const read = p.match(/^\/uploads\/read\/([0-9a-f-]+)$/);
  if (read && method === "GET") {
    media.signed(
      read[1],
      "get",
      String(req.query.expires ?? ""),
      String(req.query.signature ?? ""),
    );
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(await media.read(read[1]));
    return { status: 200, raw: true };
  }
  if (p === "/notifications/capabilities" && method === "GET") {
    if (!["h5", "ios", "android"].includes(String(req.query.platform)))
      reject(422, "INVALID_PLATFORM", "平台无效");
    return { status: 200, data: notices.capabilities() };
  }
  const supported =
    p === "/me" ||
    p === "/uploads/presign" ||
    /^\/uploads\/(local\/)?[0-9a-f-]+(\/complete)?$/.test(p) ||
    p === "/me/notifications" ||
    /^\/me\/notifications\/[0-9a-f-]+\/read$/.test(p) ||
    p === "/me/notification-subscriptions" ||
    /^\/me\/notification-subscriptions\/[0-9a-f-]+$/.test(p);
  if (!supported) return null;
  const s = await identity.session(req.cookies.qy_access ?? "");
  if (
    method !== "GET" &&
    !equal(
      String(req.headers["x-csrf-token"] ?? ""),
      identity.csrf(s.session_id),
    )
  )
    reject(403, "INVALID_CSRF", "安全校验失败");
  const input = req.body ?? {};
  const shape = (keys: string[]) => {
    if (
      !input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      Object.keys(input).some((k) => !keys.includes(k))
    )
      reject(422, "INVALID_INPUT", "请求参数无效");
  };
  const command = <T>(fn: Parameters<typeof idempotent<T>>[5], status = 200) =>
    idempotent(
      s.id,
      method,
      "/api/v1" + p,
      req.headers["idempotency-key"],
      input,
      fn,
      status,
    );
  if (p === "/me" && method === "PATCH") {
    shape(["nickname", "avatarAssetId"]);
    if (
      !Object.keys(input).length ||
      (input.nickname !== undefined &&
        (typeof input.nickname !== "string" ||
          input.nickname.trim().length < 1 ||
          input.nickname.trim().length > 30))
    )
      reject(422, "INVALID_INPUT", "昵称需要1至30个字符");
    await command(async (c, ctx) => {
      if (input.avatarAssetId !== undefined && input.avatarAssetId !== null)
        await media.assertReady(c, {
          assetId: input.avatarAssetId,
          purpose: "avatar",
          actorUserId: s.id,
          access: "owner",
        });
      if (input.nickname !== undefined)
        await c.execute("UPDATE users SET nickname=? WHERE id=?", [
          input.nickname.trim(),
          s.id,
        ]);
      if (input.avatarAssetId !== undefined)
        await c.execute("UPDATE users SET avatar_asset_id=? WHERE id=?", [
          input.avatarAssetId,
          s.id,
        ]);
      await audit(c, ctx, "account.update", "user", s.id, {
        fields: Object.keys(input),
      });
      return { updated: true };
    });
    return { status: 200, data: await identity.me(req.cookies.qy_access) };
  }
  if (p === "/uploads/presign" && method === "POST") {
    shape([
      "purpose",
      "filename",
      "contentType",
      "sizeBytes",
      "checksumSha256",
    ]);
    return {
      status: 201,
      data: await command((c, ctx) => media.presign(c, ctx, input), 201),
    };
  }
  const upload = p.match(/^\/uploads\/local\/([0-9a-f-]+)$/);
  if (upload && method === "PUT") {
    media.signed(
      upload[1],
      "put",
      String(req.query.expires ?? ""),
      String(req.query.signature ?? ""),
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 10 * 1024 * 1024) reject(413, "FILE_TOO_LARGE", "文件过大");
      chunks.push(Buffer.from(chunk));
    }
    await media.upload(
      s.id,
      upload[1],
      Buffer.concat(chunks),
      String(req.headers["content-type"]),
    );
    return { status: 204 };
  }
  const complete = p.match(/^\/uploads\/([0-9a-f-]+)\/complete$/);
  if (complete && method === "POST") {
    shape(["checksumSha256"]);
    return {
      status: 202,
      data: await command(
        (c) => media.complete(c, s.id, complete[1], input.checksumSha256),
        202,
      ),
    };
  }
  const asset = p.match(/^\/uploads\/([0-9a-f-]+)$/);
  if (asset && method === "GET")
    return {
      status: 200,
      data: await transaction((c) => media.get(c, s.id, asset[1])),
    };
  if (asset && method === "DELETE") {
    await command((c, ctx) => media.remove(c, ctx, asset[1]));
    await media.cleanup(asset[1]);
    return { status: 204 };
  }
  if (p === "/me/notifications" && method === "GET")
    return {
      status: 200,
      data: await transaction((c) =>
        notices.list(
          c,
          s.id,
          new URLSearchParams(req.originalUrl.split("?")[1] ?? ""),
        ),
      ),
    };
  const readNotice = p.match(/^\/me\/notifications\/([0-9a-f-]+)\/read$/);
  if (readNotice && method === "PUT") {
    shape([]);
    return {
      status: 200,
      data: await command((c) => notices.read(c, s.id, readNotice[1])),
    };
  }
  if (p === "/me/notification-subscriptions" && method === "POST")
    return {
      status: 201,
      data: await command((c, ctx) => notices.subscribe(c, ctx, input)),
    };
  const sub = p.match(/^\/me\/notification-subscriptions\/([0-9a-f-]+)$/);
  if (sub && method === "DELETE") {
    await command((c, ctx) => notices.unsubscribe(c, ctx, sub[1]));
    return { status: 204 };
  }
  return null;
}
