import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IdentityService } from "../src/modules/identity/service.js";
import { pool } from "../src/common/database.js";
import { redis } from "../src/modules/identity/limiter.js";
const integration = process.env.DB_NAME?.endsWith("_test") ? test : test.skip;
let code = "";
const service = new IdentityService(async (_email, value) => {
  code = value;
});
const email = `test-${randomUUID()}@example.com`;
integration(
  "register, bad-code persistence, identity reuse, refresh replay and logout",
  async () => {
    const challenge = await service.send(email, "test-" + randomUUID());
    await assert.rejects(
      service.login(challenge.challengeId, "xxxxxx", randomUUID()),
    );
    await assert.rejects(
      service.login(
        challenge.challengeId,
        code === "000000" ? "000001" : "000000",
        randomUUID(),
      ),
    );
    const [rows] = await pool.query<any[]>(
      "SELECT attempts FROM auth_challenges WHERE id=?",
      [challenge.challengeId],
    );
    assert.equal(rows[0].attempts, 1);
    const auth = await service.login(challenge.challengeId, code, randomUUID());
    assert.ok(auth.user.id);
    assert.equal((await service.me(auth.access)).id, auth.user.id);
    await assert.rejects(
      service.login(challenge.challengeId, code, randomUUID()),
    );
    const renewed = await service.refresh(auth.refresh);
    await assert.rejects(service.me(auth.access));
    assert.equal((await service.me(renewed.access)).id, auth.user.id);
    await assert.rejects(service.refresh(auth.refresh));
    await assert.rejects(service.me(renewed.access));
  },
);
integration(
  "single challenge concurrent login only succeeds once",
  async () => {
    const c = await service.send(
      "race-" + randomUUID() + "@example.com",
      "test-" + randomUUID(),
    );
    const copy = code;
    const results = await Promise.allSettled([
      service.login(c.challengeId, copy, randomUUID()),
      service.login(c.challengeId, copy, randomUUID()),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  },
);
integration("failed SMTP challenge cannot log in", async () => {
  let failedCode = "";
  const failing = new IdentityService(async (_e, c) => {
    failedCode = c;
    throw new Error("SMTP unavailable");
  });
  await assert.rejects(
    failing.send(
      "fail-" + randomUUID() + "@example.com",
      "test-" + randomUUID(),
    ),
  );
  const [rows] = await pool.query<any[]>(
    "SELECT id FROM auth_challenges WHERE delivery_status='failed' ORDER BY created_at DESC LIMIT 1",
  );
  await assert.rejects(service.login(rows[0].id, failedCode, randomUUID()));
});
after(async () => {
  await pool.end();
  if (redis.isOpen) await redis.quit();
});
integration(
  "five failed attempts persist and block correct code; expiry blocks login",
  async () => {
    const c = await service.send(
      "attempt-" + randomUUID() + "@example.com",
      "test-" + randomUUID(),
    );
    const original = code;
    for (let i = 0; i < 5; i++)
      await assert.rejects(
        service.login(
          c.challengeId,
          original === "000000" ? "000001" : "000000",
          randomUUID(),
        ),
      );
    await assert.rejects(service.login(c.challengeId, original, randomUUID()));
    const [r] = await pool.query<any[]>(
      "SELECT attempts FROM auth_challenges WHERE id=?",
      [c.challengeId],
    );
    assert.equal(r[0].attempts, 5);
    const e = await service.send(
      "expiry-" + randomUUID() + "@example.com",
      "test-" + randomUUID(),
    );
    await pool.execute(
      "UPDATE auth_challenges SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE),expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) WHERE id=?",
      [e.challengeId],
    );
    await assert.rejects(service.login(e.challengeId, code, randomUUID()));
  },
);
integration(
  "email cooldown rejects repeated send and existing user is reused",
  async () => {
    const e = "reuse-" + randomUUID() + "@example.com";
    const c = await service.send(e, "test-" + randomUUID());
    const first = await service.login(c.challengeId, code, randomUUID());
    await assert.rejects(service.send(e, "test-" + randomUUID()));
    const { digest } = await import("../src/modules/identity/crypto.js");
    await redis.del("auth:" + process.env.DB_NAME + ":email60:" + digest(e));
    const c2 = await service.send(e, "test-" + randomUUID());
    const second = await service.login(c2.challengeId, code, randomUUID());
    assert.equal(first.user.id, second.user.id);
    await service.logout(second.access);
    await assert.rejects(service.me(second.access));
  },
);
integration(
  "encrypted short retry reuses credentials only for identical request and key",
  async () => {
    const c = await service.send(
      "retry-" + randomUUID() + "@example.com",
      "test-" + randomUUID(),
    );
    const device = randomUUID(),
      key = randomUUID();
    const first = await service.login(c.challengeId, code, device, key);
    const again = await service.login(c.challengeId, code, device, key);
    assert.equal(again.access, first.access);
    assert.equal(again.refresh, first.refresh);
    const [r] = await pool.execute<any[]>(
      "SELECT retry_ciphertext FROM auth_challenges WHERE id=?",
      [c.challengeId],
    );
    assert.ok(!r[0].retry_ciphertext.includes(first.access));
    const refreshKey = randomUUID();
    const next = await service.refresh(first.refresh, refreshKey);
    const retried = await service.refresh(first.refresh, refreshKey);
    assert.equal(retried.access, next.access);
    await assert.rejects(service.refresh(first.refresh, randomUUID()));
    await assert.rejects(service.me(next.access));
  },
);
