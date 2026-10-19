import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { IdentityService } from "../src/modules/identity/service.js";
import { MediaService } from "../src/modules/uploads/service.js";
import { unitOfWork } from "../src/common/foundation.js";
import { pool, transaction } from "../src/common/database.js";
import { redis } from "../src/modules/identity/limiter.js";
const integration = process.env.DB_NAME?.endsWith("_test") ? test : test.skip;
integration(
  "separate worker consumes MySQL Outbox via Redis and creates safe WebP",
  async () => {
    let code = "";
    const identity = new IdentityService(async (_e, c) => {
      code = c;
    });
    const challenge = await identity.send(
      "worker-" + randomUUID() + "@example.com",
      "worker-" + randomUUID(),
    );
    const auth = await identity.login(
      challenge.challengeId,
      code,
      randomUUID(),
    );
    const media = new MediaService();
    const bytes = await sharp({
      create: { width: 5, height: 5, channels: 3, background: "#ab91de" },
    })
      .png()
      .toBuffer();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const asset = await unitOfWork.runForUser(auth.user.id, (c, ctx) =>
      media.presign(c, ctx, {
        purpose: "avatar",
        filename: "worker.png",
        contentType: "image/png",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
      }),
    );
    await media.upload(auth.user.id, asset.assetId, bytes, "image/png");
    await unitOfWork.runForUser(auth.user.id, (c) =>
      media.complete(c, auth.user.id, asset.assetId, checksum),
    );
    const worker = spawn(
      process.execPath,
      ["--import", "tsx", "src/worker.ts"],
      { env: process.env, stdio: "ignore" },
    );
    try {
      let result;
      for (let i = 0; i < 80; i++) {
        result = await transaction((c) =>
          media.get(c, auth.user.id, asset.assetId),
        );
        if (result.status === "ready") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.equal(result?.status, "ready");
      const safe = await media.read(asset.assetId);
      assert.equal(result?.sizeBytes, safe.length);
      assert.equal((await sharp(safe).metadata()).format, "webp");
    } finally {
      worker.kill("SIGTERM");
    }
  },
);
after(async () => {
  await pool.end();
  if (redis.isOpen) await redis.quit();
});
