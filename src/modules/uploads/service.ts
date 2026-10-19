import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { PoolConnection } from "mysql2/promise";
import { pool, rows, transaction } from "../../common/database.js";
import { digest, equal } from "../identity/crypto.js";
import { reject } from "../../common/error.js";
import {
  requireAdmin,
  audit,
  type Context,
  isUuid,
} from "../../common/foundation.js";
import { origin } from "../../common/config.js";
import { enqueue } from "../../common/outbox.js";
const directory = resolve(".local/private-media");
const purposes = [
  "meal_photo",
  "avatar",
  "course_cover",
  "activity_cover",
  "reward_image",
];
const limits = (purpose: string) =>
  purpose === "avatar" ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
const path = (id: string, safe = false) =>
  resolve(directory, id + (safe ? ".webp" : ".raw"));
export class MediaService {
  async presign(c: PoolConnection, ctx: Context, input: any) {
    if (!purposes.includes(input.purpose))
      reject(
        422,
        "UNSUPPORTED_MEDIA",
        "当前支持JPEG、PNG、WebP图片；视频转码尚未配置",
      );
    if (!["meal_photo", "avatar"].includes(input.purpose))
      await requireAdmin(c, ctx.userId);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(input.contentType) ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > limits(input.purpose) ||
      typeof input.filename !== "string" ||
      input.filename.length < 1 ||
      input.filename.length > 150 ||
      !/^([0-9a-f]{64})$/.test(input.checksumSha256)
    )
      reject(422, "INVALID_MEDIA", "图片格式、大小或校验和无效");
    const id = randomUUID();
    const exp = Math.floor(Date.now() / 1000) + 300;
    await c.execute(
      "INSERT INTO media_assets(id,user_id,purpose,bucket,object_key,content_type,size_bytes,checksum_sha256,expires_at)VALUES(?,?,?,'local-private',?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE))",
      [
        id,
        ctx.userId,
        input.purpose,
        id + ".raw",
        input.contentType,
        input.sizeBytes,
        input.checksumSha256,
      ],
    );
    return {
      assetId: id,
      method: "PUT",
      uploadUrl:
        origin +
        `/api/v1/uploads/local/${id}?expires=${exp}&signature=${digest("put:" + id + ":" + exp)}`,
      requiredHeaders: { "Content-Type": input.contentType },
      expiresAt: new Date(exp * 1000).toISOString(),
      maxSizeBytes: limits(input.purpose),
    };
  }
  async own(c: PoolConnection, userId: string, id: string) {
    if (!isUuid(id)) reject(404, "NOT_FOUND", "文件不存在");
    const a = (
      await rows(c, "SELECT * FROM media_assets WHERE id=? AND user_id=?", [
        id,
        userId,
      ])
    )[0];
    if (!a) reject(404, "NOT_FOUND", "文件不存在");
    return a;
  }
  signed(id: string, mode: string, exp: string, signature: string) {
    if (
      !isUuid(id) ||
      !/^\d{10}$/.test(exp) ||
      Number(exp) < Date.now() / 1000 ||
      Number(exp) > Date.now() / 1000 + 301 ||
      !equal(signature, digest(mode + ":" + id + ":" + exp))
    )
      reject(403, "INVALID_MEDIA_SIGNATURE", "文件链接已失效");
  }
  async upload(userId: string, id: string, bytes: Buffer, contentType: string) {
    await transaction(async (c) => {
      const a = await this.own(c, userId, id);
      if (
        a.status !== "pending" ||
        new Date(a.expires_at.replace(" ", "T") + "Z").getTime() < Date.now()
      )
        reject(409, "UPLOAD_CLOSED", "上传已结束或过期");
      if (
        bytes.length !== Number(a.size_bytes) ||
        contentType !== a.content_type ||
        createHash("sha256").update(bytes).digest("hex") !== a.checksum_sha256
      )
        reject(422, "INVALID_MEDIA", "文件内容与声明不符");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path(id), bytes, { flag: "wx", mode: 0o600 }).catch(
        (e: any) => {
          if (e.code !== "EEXIST") throw e;
        },
      );
    });
  }
  async complete(
    c: PoolConnection,
    userId: string,
    id: string,
    checksum: string,
  ) {
    const a = await this.own(c, userId, id);
    if (checksum !== a.checksum_sha256)
      reject(422, "INVALID_CHECKSUM", "文件校验和不匹配");
    if (["validating", "ready", "rejected"].includes(a.status))
      return { assetId: id, status: a.status };
    try {
      await readFile(path(id));
    } catch {
      reject(409, "UPLOAD_NOT_RECEIVED", "请先完成文件上传");
    }
    await c.execute(
      "UPDATE media_assets SET status='validating' WHERE id=? AND status='pending'",
      [id],
    );
    await enqueue(c, {
      eventType: "media.validate.requested.v1",
      aggregateType: "media",
      aggregateId: id,
      eventKey: "media.validate.requested.v1:" + id,
      schemaVersion: 1,
      payload: { assetId: id },
    });
    return { assetId: id, status: "validating" };
  }
  async validate(id: string) {
    const [records] = await pool.execute<any[]>(
      "SELECT * FROM media_assets WHERE id=? AND status='validating'",
      [id],
    );
    if (!records.length) return;
    const a = records[0];
    try {
      const data = await readFile(path(id));
      if (
        data.length !== Number(a.size_bytes) ||
        createHash("sha256").update(data).digest("hex") !== a.checksum_sha256
      )
        throw Error("CHECKSUM");
      const image = sharp(data, {
        limitInputPixels: 40000000,
        failOn: "warning",
        animated: false,
      });
      const metadata = await image.metadata();
      const mime: Record<string, string> = {
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      };
      if (
        mime[metadata.format ?? ""] !== a.content_type ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) > 1
      )
        throw Error("FORMAT");
      const safe = await image
        .rotate()
        .resize({
          width: 4096,
          height: 4096,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 88 })
        .toBuffer();
      await writeFile(path(id, true), safe, { mode: 0o600 });
      await pool.execute(
        "UPDATE media_assets SET status='ready',safe_object_key=?,safe_content_type='image/webp',safe_size_bytes=?,error_code=NULL WHERE id=? AND status='validating'",
        [id + ".webp", safe.length, id],
      );
    } catch {
      await pool.execute(
        "UPDATE media_assets SET status='rejected',error_code='INVALID_MEDIA' WHERE id=? AND status='validating'",
        [id],
      );
    }
  }
  async assertReady(
    c: PoolConnection,
    input: {
      assetId: string;
      purpose: string;
      actorUserId: string | null;
      access: "owner" | "admin_material" | "public_display";
    },
  ) {
    const a = (
      await rows(c, "SELECT * FROM media_assets WHERE id=?", [input.assetId])
    )[0];
    if (
      !a ||
      a.status !== "ready" ||
      !a.safe_size_bytes ||
      a.purpose !== input.purpose
    )
      reject(404, "MEDIA_NOT_READY", "文件未就绪");
    if (input.access === "owner") {
      if (
        !["avatar", "meal_photo"].includes(a.purpose) ||
        a.user_id !== input.actorUserId
      )
        reject(404, "NOT_FOUND", "文件不存在");
    } else if (input.access === "admin_material") {
      if (["avatar", "meal_photo"].includes(a.purpose) || !input.actorUserId)
        reject(403, "INVALID_MEDIA_ACCESS", "资源用途无效");
      await requireAdmin(c, input.actorUserId);
    } else if (a.purpose === "meal_photo")
      reject(403, "PRIVATE_MEDIA", "私人餐照不可公开");
    return a;
  }
  async readUrl(c: PoolConnection, userId: string, id: string) {
    const a = await this.own(c, userId, id);
    if (a.status !== "ready" || !a.safe_size_bytes) return null;
    const exp = Math.floor(Date.now() / 1000) + 300;
    return {
      readUrl:
        origin +
        `/api/v1/uploads/read/${id}?expires=${exp}&signature=${digest("get:" + id + ":" + exp)}`,
      readUrlExpiresAt: new Date(exp * 1000).toISOString(),
    };
  }
  async get(c: PoolConnection, userId: string, id: string) {
    const a = await this.own(c, userId, id);
    return {
      assetId: id,
      status: a.status,
      purpose: a.purpose,
      contentType: a.safe_content_type ?? a.content_type,
      sizeBytes: Number(a.safe_size_bytes ?? a.size_bytes),
      originalContentType: a.content_type,
      originalSizeBytes: Number(a.size_bytes),
      readUrl: null,
      readUrlExpiresAt: null,
      errorCode: a.error_code,
      ...(await this.readUrl(c, userId, id)),
    };
  }
  async read(id: string) {
    const [r] = await pool.execute<any[]>(
      "SELECT id FROM media_assets WHERE id=? AND status='ready'",
      [id],
    );
    if (!r.length) reject(404, "NOT_FOUND", "文件不存在");
    return readFile(path(id, true));
  }
  async remove(c: PoolConnection, ctx: Context, id: string) {
    const a = await this.own(c, ctx.userId, id);
    if (a.status === "validating")
      reject(409, "ASSET_IN_USE", "文件正在处理中");
    try {
      await c.execute("DELETE FROM media_assets WHERE id=?", [id]);
    } catch (e: any) {
      if (e.code === "ER_ROW_IS_REFERENCED_2")
        reject(409, "ASSET_IN_USE", "文件正在被业务使用");
      throw e;
    }
    await audit(c, ctx, "media.delete", "media", id, {});
    return { deleted: true };
  }
  async cleanup(id: string) {
    await Promise.all([
      unlink(path(id)).catch(() => {}),
      unlink(path(id, true)).catch(() => {}),
    ]);
  }
}
