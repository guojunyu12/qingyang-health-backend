import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { IdentityService } from "../src/modules/identity/service.js";
import { MediaService } from "../src/modules/uploads/service.js";
import { pool } from "../src/common/database.js";
import { redis } from "../src/modules/identity/limiter.js";

const integration = process.env.DB_NAME?.endsWith("_test") ? test : test.skip;
after(async () => {
  await pool.end();
  if (redis.isOpen) await redis.quit();
});
type Session = { cookie: string; csrf: string; id: string };
type Material = {
  assetId: string;
  purpose: string;
  status: string;
  contentType: string;
  sizeBytes: number;
  readUrl: string | null;
  errorCode: string | null;
};
type Presign = {
  assetId: string;
  method: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
};

integration(
  "M05 admin materials use M01 signed uploads and exclude private assets",
  async () => {
    process.env.AUTH_NO_LISTEN = "1";
    const { createApp } = await import("../src/main.js");
    let code = "";
    const identity = new IdentityService(async (_email, value) => {
      code = value;
    });
    const app = await createApp(identity);
    await app.listen(0, "127.0.0.1");
    const local = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const bytes = await sharp({
      create: { width: 24, height: 24, channels: 4, background: "#146652" },
    })
      .png()
      .toBuffer();
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const request = (
      session: Session,
      path: string,
      method = "GET",
      body?: unknown,
    ) =>
      fetch(local + "/api/v1" + path, {
        method,
        headers: {
          Origin: "http://127.0.0.1:3003",
          Cookie: session.cookie,
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const read = async <T>(response: Response, status = 200): Promise<T> => {
      const payload = await response.json();
      assert.equal(response.status, status, JSON.stringify(payload));
      return payload.data as T;
    };
    const login = async (ip: string): Promise<Session> => {
      const challenge = await identity.send(
        `m05-media-${randomUUID()}@example.com`,
        ip,
      );
      const auth = await identity.login(
        challenge.challengeId,
        code,
        randomUUID(),
        randomUUID(),
      );
      const session = await identity.session(auth.access);
      return {
        cookie: `qy_access=${auth.access}`,
        csrf: identity.csrf(session.session_id),
        id: session.id,
      };
    };
    try {
      const admin = await login("2001:db8::51"),
        other = await login("2001:db8::52");
      await pool.execute(
        "INSERT INTO user_roles(id,user_id,role) VALUES (?,?,'admin')",
        [randomUUID(), admin.id],
      );
      const presign = (purpose: string) =>
        request(admin, "/uploads/presign", "POST", {
          purpose,
          filename: "test.png",
          contentType: "image/png",
          sizeBytes: bytes.length,
          checksumSha256,
        }).then((r) => read<Presign>(r, 201));
      const upload = async (asset: Presign) => {
        assert.equal(asset.method, "PUT");
        const url = new URL(asset.uploadUrl);
        const result = await fetch(local + url.pathname + url.search, {
          method: "PUT",
          headers: {
            Origin: "http://127.0.0.1:3003",
            Cookie: admin.cookie,
            "X-CSRF-Token": admin.csrf,
            ...asset.requiredHeaders,
          },
          body: new Uint8Array(bytes),
        });
        assert.equal(result.status, 204, await result.text());
        await read(
          await request(admin, `/uploads/${asset.assetId}/complete`, "POST", {
            checksumSha256,
          }),
          202,
        );
        await new MediaService().validate(asset.assetId);
      };
      const cover = await presign("activity_cover");
      const pending = await read<Material>(
        await request(admin, `/admin/media-assets/${cover.assetId}`),
      );
      assert.equal(pending.status, "pending");
      assert.equal(pending.readUrl, null);
      const activity = {
        title: "素材边界测试",
        category: "walking",
        description: "隔离测试",
        locationName: "测试公园",
        address: "测试地址",
        visibility: "public",
        coverAssetId: cover.assetId,
      };
      const rejected = await request(
        admin,
        "/admin/activities",
        "POST",
        activity,
      );
      assert.equal(rejected.status, 404, await rejected.clone().text());
      assert.equal((await rejected.json()).error.code, "MEDIA_NOT_READY");
      await upload(cover);
      const ready = await read<Material>(
        await request(admin, `/admin/media-assets/${cover.assetId}`),
      );
      assert.equal(ready.assetId, cover.assetId);
      assert.equal(ready.purpose, "activity_cover");
      assert.equal(ready.status, "ready");
      assert.equal(ready.contentType, "image/webp");
      assert.ok(ready.sizeBytes > 0);
      assert.equal(ready.errorCode, null);
      assert.ok(ready.readUrl);
      const signed = new URL(ready.readUrl);
      const image = await fetch(local + signed.pathname + signed.search);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/webp");
      assert.equal(
        (await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format,
        "webp",
      );
      await read(
        await request(admin, "/admin/activities", "POST", activity),
        201,
      );
      assert.equal((await request(other, "/admin/media-assets")).status, 403);
      assert.equal(
        (await request(other, `/admin/media-assets/${cover.assetId}`)).status,
        403,
      );
      assert.equal(
        (await request(other, `/uploads/${cover.assetId}`)).status,
        404,
      );
      const privateIds: string[] = [];
      for (const purpose of ["avatar", "meal_photo"]) {
        const asset = await presign(purpose);
        await upload(asset);
        privateIds.push(asset.assetId);
        assert.equal(
          (await request(admin, `/admin/media-assets/${asset.assetId}`)).status,
          404,
        );
        assert.equal(
          (await request(admin, `/admin/media-assets?purpose=${purpose}`))
            .status,
          422,
        );
      }
      const list = await read<{ items: Material[] }>(
        await request(admin, "/admin/media-assets?status=ready&limit=100"),
      );
      assert.ok(list.items.some((row) => row.assetId === cover.assetId));
      assert.ok(
        list.items.every((row) =>
          ["activity_cover", "reward_image"].includes(row.purpose),
        ),
      );
      assert.ok(list.items.every((row) => !privateIds.includes(row.assetId)));
    } finally {
      await app.close();
    }
  },
);
