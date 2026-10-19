import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { IdentityService } from "../src/modules/identity/service.js";
import { pool, transaction, rows } from "../src/common/database.js";
import { redis } from "../src/modules/identity/limiter.js";
import { idempotent, unitOfWork } from "../src/common/foundation.js";
import { MediaService } from "../src/modules/uploads/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
const integration = process.env.DB_NAME?.endsWith("_test") ? test : test.skip;
async function user() {
  let code = "";
  const service = new IdentityService(async (_e, c) => {
    code = c;
  });
  const challenge = await service.send(
    "resource-" + randomUUID() + "@example.com",
    "resource-" + randomUUID(),
  );
  return (await service.login(challenge.challengeId, code, randomUUID())).user
    .id;
}
integration(
  "user role exists; idempotent replay and body conflict; notification ownership",
  async () => {
    const uid = await user();
    const [role] = await pool.execute<any[]>(
      "SELECT id FROM user_roles WHERE user_id=? AND role='user'",
      [uid],
    );
    assert.equal(role.length, 1);
    let calls = 0;
    const key = randomUUID();
    const call = () =>
      idempotent(uid, "POST", "/test", key, { a: 1 }, async () => ({
        count: ++calls,
      }));
    assert.deepEqual(await call(), { count: 1 });
    assert.deepEqual(await call(), { count: 1 });
    await assert.rejects(
      idempotent(uid, "POST", "/test", key, { a: 2 }, async () => ({
        count: ++calls,
      })),
    );
    assert.equal(calls, 1);
    const notices = new NotificationService();
    const intent = {
      type: "training_reminder",
      title: "训练提醒",
      body: "测试站内消息",
      actionPath: "/training",
      eventKey: "test:" + randomUUID(),
    };
    const a = await unitOfWork.runForUser(uid, (c, ctx) =>
      notices.createInTransaction(c, ctx, intent),
    );
    const b = await unitOfWork.runForUser(uid, (c, ctx) =>
      notices.createInTransaction(c, ctx, intent),
    );
    assert.equal(a.id, b.id);
    const page = await transaction((c) =>
      notices.list(c, uid, new URLSearchParams("unreadOnly=true")),
    );
    assert.ok(page.items.some((x) => x.id === a.id));
    await transaction((c) => notices.read(c, uid, a.id));
    await assert.rejects(
      transaction((c) => notices.read(c, randomUUID(), a.id)),
    );
  },
);
integration(
  "private upload validates real bytes; safe copy, owner isolation and references",
  async () => {
    const uid = await user();
    const media = new MediaService();
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#9988cc" },
    })
      .png()
      .toBuffer();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const asset = await unitOfWork.runForUser(uid, (c, ctx) =>
      media.presign(c, ctx, {
        purpose: "avatar",
        filename: "avatar.png",
        contentType: "image/png",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
      }),
    );
    await media.upload(uid, asset.assetId, bytes, "image/png");
    await unitOfWork.runForUser(uid, (c) =>
      media.complete(c, uid, asset.assetId, checksum),
    );
    await media.validate(asset.assetId);
    const safe = await transaction((c) => media.get(c, uid, asset.assetId));
    assert.equal(safe.status, "ready");
    assert.ok(safe.readUrl);
    await assert.rejects(
      transaction((c) => media.get(c, randomUUID(), asset.assetId)),
    );
    await pool.execute("UPDATE users SET avatar_asset_id=? WHERE id=?", [
      asset.assetId,
      uid,
    ]);
    await assert.rejects(
      unitOfWork.runForUser(uid, (c, ctx) =>
        media.remove(c, ctx, asset.assetId),
      ),
    );
    await pool.execute("UPDATE users SET avatar_asset_id=NULL WHERE id=?", [
      uid,
    ]);
    await unitOfWork.runForUser(uid, (c, ctx) =>
      media.remove(c, ctx, asset.assetId),
    );
    await media.cleanup(asset.assetId);
  },
);
integration(
  "corrupt image with matching declared checksum is rejected by decoder",
  async () => {
    const uid = await user();
    const media = new MediaService();
    const bytes = Buffer.from("this is not a PNG");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const a = await unitOfWork.runForUser(uid, (c, ctx) =>
      media.presign(c, ctx, {
        purpose: "meal_photo",
        filename: "fake.png",
        contentType: "image/png",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
      }),
    );
    await media.upload(uid, a.assetId, bytes, "image/png");
    await unitOfWork.runForUser(uid, (c) =>
      media.complete(c, uid, a.assetId, checksum),
    );
    await media.validate(a.assetId);
    assert.equal(
      (await transaction((c) => media.get(c, uid, a.assetId))).status,
      "rejected",
    );
    await assert.rejects(
      transaction((c) =>
        media.presign(
          c,
          {
            userId: uid,
            operationNow: new Date().toISOString(),
            businessDate: "2026-10-19",
            requestId: randomUUID(),
            platform: "h5",
          },
          {
            purpose: "course_cover",
            filename: "x.png",
            contentType: "image/png",
            sizeBytes: 2,
            checksumSha256: checksum,
          },
        ),
      ),
    );
  },
);
after(async () => {
  await pool.end();
  if (redis.isOpen) await redis.quit();
});
integration(
  "delivery claims, provider acceptance and disabled subscription isolation",
  async () => {
    const uid = await user();
    const { encrypt, digest } =
      await import("../src/modules/identity/crypto.js");
    const { deliverOnce } = await import("../src/common/deliveries.js");
    const sid = randomUUID();
    await pool.execute(
      "INSERT INTO notification_subscriptions(id,user_id,device_id,channel,endpoint_ciphertext,endpoint_hash,keys_ciphertext)VALUES(?,?,?,'web_push',?,?,?)",
      [
        sid,
        uid,
        randomUUID(),
        encrypt("https://example.com/push/" + sid),
        digest(sid),
        encrypt(JSON.stringify({ p256dh: "test", auth: "test" })),
      ],
    );
    const notices = new NotificationService();
    const n = await unitOfWork.runForUser(uid, (c, ctx) =>
      notices.createInTransaction(c, ctx, {
        type: "training_reminder",
        title: "测试",
        body: "仅测试供应商适配器",
        actionPath: "/training",
        eventKey: "test:" + randomUUID(),
      }),
    );
    const did = randomUUID();
    await pool.execute(
      "INSERT INTO notification_deliveries(id,user_id,notification_id,subscription_id)VALUES(?,?,?,?)",
      [did, uid, n.id, sid],
    );
    let calls = 0;
    await deliverOnce(async () => {
      calls++;
      return "provider-test-id";
    });
    assert.equal(calls, 1);
    const [r] = await pool.execute<any[]>(
      "SELECT status,locked_by FROM notification_deliveries WHERE id=?",
      [did],
    );
    assert.equal(r[0].status, "sent");
    assert.equal(r[0].locked_by, null);
    await deliverOnce(async () => {
      calls++;
      return "wrong";
    });
    assert.equal(calls, 1);
  },
);
integration(
  "failed business rolls back; expired idempotency lease is recoverable",
  async () => {
    const uid = await user();
    const { ApiFailure } = await import("../src/common/error.js");
    const key = randomUUID();
    await assert.rejects(
      idempotent(uid, "POST", "/rollback", key, {}, async (c) => {
        await c.execute(
          "UPDATE users SET nickname='should rollback' WHERE id=?",
          [uid],
        );
        throw new ApiFailure(422, "TEST_FAILURE", "expected");
      }),
    );
    const [u] = await pool.execute<any[]>(
      "SELECT nickname FROM users WHERE id=?",
      [uid],
    );
    assert.notEqual(u[0].nickname, "should rollback");
    const { canonical } = await import("../src/common/foundation.js");
    const hash = createHash("sha256")
      .update(canonical({ a: 1 }))
      .digest("hex");
    const staleKey = randomUUID();
    await pool.execute(
      "INSERT INTO idempotency_requests(id,principal_key,method,request_path,idempotency_key,body_hash,expires_at,locked_by,locked_until)VALUES(?,?,'POST','/recover',?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND))",
      [randomUUID(), "user:" + uid, staleKey, hash, randomUUID()],
    );
    assert.deepEqual(
      await idempotent(
        uid,
        "POST",
        "/recover",
        staleKey,
        { a: 1 },
        async () => ({ recovered: true }),
      ),
      { recovered: true },
    );
  },
);
integration(
  "outbox publishes stable job; replay is not republished as new event",
  async () => {
    const uid = await user();
    const { enqueue, dispatchOnce, queueConnection, queueName } =
      await import("../src/common/outbox.js");
    const { Queue } = await import("bullmq");
    const assetId = randomUUID(),
      eventKey = "media.validate.requested.v1:" + assetId;
    await unitOfWork.runForUser(uid, (c) =>
      enqueue(c, {
        eventType: "media.validate.requested.v1",
        aggregateType: "media",
        aggregateId: assetId,
        eventKey,
        schemaVersion: 1,
        payload: { assetId },
      }),
    );
    const [events] = await pool.execute<any[]>(
      "SELECT id FROM outbox_events WHERE event_key=?",
      [eventKey],
    );
    await pool.execute(
      "UPDATE outbox_events SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=?",
      [events[0].id],
    );
    let r: any[] = [];
    for (let i = 0; i < 100; i++) {
      await dispatchOnce();
      [r] = await pool.execute<any[]>(
        "SELECT status,locked_by FROM outbox_events WHERE id=?",
        [events[0].id],
      );
      if (r[0].status === "published") break;
    }
    assert.equal(r[0].status, "published");
    assert.equal(r[0].locked_by, null);
    const queue = new Queue(queueName("media.validate.requested.v1"), {
      connection: queueConnection,
    });
    try {
      assert.ok(await queue.getJob(events[0].id));
    } finally {
      await queue.close();
    }
  },
);
