import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { IdentityService } from "../src/modules/identity/service.js";
import { pool } from "../src/common/database.js";
import { redis } from "../src/modules/identity/limiter.js";
import { MediaService } from "../src/modules/uploads/service.js";
const integration = process.env.DB_NAME?.endsWith("_test") ? test : test.skip;
integration(
  "HTTP cookies, CSRF, account update, signed upload and logout",
  async () => {
    process.env.AUTH_NO_LISTEN = "1";
    const { createApp } = await import("../src/main.js");
    let code = "";
    const service = new IdentityService(async (_email, c) => {
      code = c;
    });
    const app = await createApp(service);
    await app.listen(0, "127.0.0.1");
    const port = app.getHttpServer().address().port;
    const base = `http://127.0.0.1:${port}/api/v1`;
    let cookies = "";
    const request = async (
      path: string,
      method = "GET",
      data?: any,
      headers: Record<string, string> = {},
    ) =>
      fetch(base + path, {
        method,
        headers: {
          Origin: "http://127.0.0.1:3001",
          Cookie: cookies,
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
    try {
      assert.equal((await request("/me")).status, 401);
      const email = "http-" + randomUUID() + "@example.com";
      let response = await request("/auth/email-codes", "POST", {
        email,
        purpose: "login",
      });
      assert.equal(response.status, 200);
      const challenge = (await response.json()).data;
      response = await request("/auth/login", "POST", {
        challengeId: challenge.challengeId,
        code,
        deviceId: randomUUID(),
        platform: "h5",
      });
      assert.equal(response.status, 200);
      assert.ok(
        response.headers.getSetCookie().every((x) => x.includes("HttpOnly")),
      );
      cookies = response.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; ");
      const auth = (await response.json()).data;
      assert.ok(!auth.access && !auth.refresh);
      const csrf = (await (await request("/auth/csrf")).json()).data.csrfToken;
      assert.equal(
        (
          await request(
            "/me",
            "PATCH",
            { nickname: "新昵称" },
            { "Idempotency-Key": randomUUID() },
          )
        ).status,
        403,
      );
      const profileKey = randomUUID();
      response = await request(
        "/me",
        "PATCH",
        { nickname: "新昵称" },
        { "X-CSRF-Token": csrf, "Idempotency-Key": profileKey },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.nickname, "新昵称");
      await request(
        "/me",
        "PATCH",
        { nickname: "后一次修改" },
        { "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() },
      );
      const replay = await request(
        "/me",
        "PATCH",
        { nickname: "新昵称" },
        { "X-CSRF-Token": csrf, "Idempotency-Key": profileKey },
      );
      assert.equal(
        (await replay.json()).data.nickname,
        "新昵称",
        "replay returns original result rather than current profile",
      );

      assert.equal(
        (
          await request(
            "/me",
            "PATCH",
            { role: "admin" },
            { "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() },
          )
        ).status,
        422,
      );
      const image = await sharp({
        create: { width: 4, height: 4, channels: 3, background: "#c0b1e8" },
      })
        .png()
        .toBuffer();
      const checksum = createHash("sha256").update(image).digest("hex");
      response = await request(
        "/uploads/presign",
        "POST",
        {
          purpose: "avatar",
          filename: "a.png",
          contentType: "image/png",
          sizeBytes: image.length,
          checksumSha256: checksum,
        },
        { "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() },
      );
      assert.equal(response.status, 201);
      const signed = (await response.json()).data;
      const uploadUrl = new URL(signed.uploadUrl);
      const put = await fetch(
        base + uploadUrl.pathname.replace("/api/v1", "") + uploadUrl.search,
        {
          method: "PUT",
          headers: {
            Origin: "http://127.0.0.1:3001",
            Cookie: cookies,
            "Content-Type": "image/png",
            "X-CSRF-Token": csrf,
          },
          body: image,
        },
      );
      assert.equal(put.status, 204);
      response = await request(
        "/uploads/" + signed.assetId + "/complete",
        "POST",
        { checksumSha256: checksum },
        { "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() },
      );
      assert.equal(response.status, 202);
      await new MediaService().validate(signed.assetId);
      response = await request("/uploads/" + signed.assetId);
      assert.equal((await response.json()).data.status, "ready");
      await pool.execute(
        "UPDATE user_sessions SET access_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=?",
        [auth.user.id],
      );
      assert.equal((await request("/me")).status, 401);
      response = await request(
        "/auth/refresh",
        "POST",
        {},
        { "X-CSRF-Token": csrf },
      );
      assert.equal(response.status, 200);
      cookies = response.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; ");
      response = await request(
        "/auth/logout",
        "POST",
        {},
        { "X-CSRF-Token": csrf },
      );
      assert.equal(response.status, 204);
      assert.equal((await request("/me")).status, 401);
    } finally {
      await app.close();
    }
  },
);
after(async () => {
  await pool.end();
  if (redis.isOpen) await redis.quit();
});
