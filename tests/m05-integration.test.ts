import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { IdentityService } from "../src/modules/identity/service.js";
import { pool } from "../src/common/database.js";
import { redis } from "../src/modules/identity/limiter.js";
const integration = process.env.DB_NAME?.endsWith("_test") ? test : test.skip;
after(async () => {
  await pool.end();
  if (redis.isOpen) await redis.quit();
});
integration(
  "M05 reuses real email sessions, isolates admin and preserves M01 routes",
  async () => {
    process.env.AUTH_NO_LISTEN = "1";
    const { createApp } = await import("../src/main.js");
    let code = "";
    const identity = new IdentityService(async (_email, value) => {
      code = value;
    });
    const app = await createApp(identity);
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    let cookie = "";
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(base + path, {
        method,
        headers: {
          Origin: "http://127.0.0.1:3001",
          Cookie: cookie,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const [ruleRows] = await pool.query<any[]>(
      "SELECT code,active FROM point_task_definitions WHERE code IN ('daily_checkin','daily_water','daily_meal')",
    );
    await pool.execute(
      "UPDATE point_task_definitions SET active=1 WHERE code IN ('daily_checkin','daily_water','daily_meal')",
    );
    try {
      assert.equal((await request("/me/m05-session")).status, 401);
      assert.equal((await request("/me/points/account")).status, 401);
      const challenge = (
        await (
          await request("/auth/email-codes", "POST", {
            email: `m05-${randomUUID()}@example.com`,
            purpose: "login",
          })
        ).json()
      ).data;
      const login = await request("/auth/login", "POST", {
        challengeId: challenge.challengeId,
        code,
        deviceId: randomUUID(),
        platform: "h5",
      });
      assert.equal(login.status, 200);
      cookie = login.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; ");
      const user = (await (await request("/me")).json()).data;
      const sessionResponse = await request("/me/m05-session");
      assert.equal(sessionResponse.headers.get("cache-control"), "no-store");
      const session = (await sessionResponse.json()).data;
      assert.equal(session.id, user.id);
      assert.equal(session.identityMode, "m01_email");
      assert.ok(session.csrfToken);
      const pendingRequestId = randomUUID();
      const pendingKey = randomUUID();
      await pool.execute(
        "INSERT INTO idempotency_requests(id,principal_key,method,request_path,idempotency_key,body_hash,status,expires_at,locked_by,locked_until) VALUES(?,?,'POST','/api/v1/me/points/check-in',?,?,'processing',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND))",
        [
          pendingRequestId,
          "user:" + user.id,
          pendingKey,
          createHash("sha256").update("{}").digest("hex"),
          randomUUID(),
        ],
      );
      try {
        const pending = await request("/me/points/check-in", "POST", {}, {
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": pendingKey,
        });
        assert.equal(pending.status, 409);
        assert.equal(pending.headers.get("Retry-After"), "2");
        const error = (await pending.json()).error;
        assert.equal(error.code, "REQUEST_IN_PROGRESS");
        assert.equal(error.retryAfterSeconds, 2);
      } finally {
        await pool.execute("DELETE FROM idempotency_requests WHERE id=?", [
          pendingRequestId,
        ]);
      }
      assert.equal((await request("/admin/points/accounts")).status, 403);
      assert.equal((await request("/admin/overview")).status, 403);
      const account = await request("/me/points/account");
      assert.equal(account.status, 200);
      assert.equal((await account.json()).data.balance, 0);
      assert.equal(
        (
          await request(
            "/me/points/check-in",
            "POST",
            {},
            { "Idempotency-Key": randomUUID() },
          )
        ).status,
        403,
      );
      const headers = {
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": randomUUID(),
      };
      const checkin = await request("/me/points/check-in", "POST", {}, headers);
      assert.equal(checkin.status, 200, await checkin.clone().text());
      const first = await checkin.json(),
        repeated = await (
          await request("/me/points/check-in", "POST", {}, headers)
        ).json();
      assert.deepEqual(repeated.data, first.data);
      const water = await request(
        "/me/water-records",
        "POST",
        { amountMl: 250 },
        { "X-CSRF-Token": session.csrfToken, "Idempotency-Key": randomUUID() },
      );
      assert.equal(water.status, 201);
      assert.equal((await water.json()).data.awards.length, 1);
      const meal = await request(
        "/me/meals",
        "POST",
        {
          mealType: "lunch",
          source: "manual",
          items: [
            {
              nutritionSource: "user",
              name: "测试餐",
              grams: 100,
              caloriesKcal: 100,
              carbsG: null,
              proteinG: null,
              fatG: null,
            },
          ],
        },
        { "X-CSRF-Token": session.csrfToken, "Idempotency-Key": randomUUID() },
      );
      assert.equal(meal.status, 201, await meal.clone().text());
      assert.equal((await meal.json()).data.awards.length, 1);
      assert.equal(
        (await (await request("/me/points/account")).json()).data.balance,
        25,
      );
      const read = async (response: Response, expected = 200) => {
        const payload = await response.json();
        assert.equal(response.status, expected, JSON.stringify(payload));
        return payload.data;
      };
      await pool.execute(
        "INSERT INTO user_roles(id,user_id,role) VALUES (?,?,'admin')",
        [randomUUID(), user.id],
      );
      const adminRequest = (path: string, method = "GET", body?: unknown) =>
        request(path, method, body, {
          Origin: "http://127.0.0.1:3003",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": randomUUID(),
        });
      assert.equal((await adminRequest("/admin/overview")).status, 200);
      const unavailableReward = await read(
        await adminRequest("/admin/points/rewards", "POST", {
          title: "未配置供应商保护测试",
          description: "仅隔离测试库使用，不对应真实权益",
          costPoints: 10,
          stock: 2,
          dailyLimit: 1,
        }),
        201,
      );
      const publish = await adminRequest(
        `/admin/points/rewards/${unavailableReward.id}/publish`,
        "POST",
        { version: unavailableReward.version },
      );
      assert.equal(publish.status, 503);
      assert.equal((await publish.json()).error.code, "PROVIDER_UNAVAILABLE");
      // Simulate an already published catalog item after supplier configuration is removed.
      // This is isolated test setup, never an operational publication path.
      await pool.execute("UPDATE point_rewards SET status='published' WHERE id=?", [
        unavailableReward.id,
      ]);
      const refusedRedemption = await request("/me/points/redemptions", "POST", {
        rewardId: unavailableReward.id,
        expectedRewardVersion: unavailableReward.version,
        quantity: 1,
      }, {
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": randomUUID(),
      });
      assert.equal(refusedRedemption.status, 503);
      assert.equal((await refusedRedemption.json()).error.code, "PROVIDER_UNAVAILABLE");
      const [unchanged] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
        "SELECT r.stock,a.balance,(SELECT COUNT(*) FROM point_redemptions WHERE reward_id=r.id) orders FROM point_rewards r JOIN point_accounts a ON a.user_id=? WHERE r.id=?",
        [user.id, unavailableReward.id],
      );
      assert.equal(unchanged[0].stock, 2);
      assert.equal(unchanged[0].balance, 25);
      assert.equal(unchanged[0].orders, 0);
      const activity = await read(
        await adminRequest("/admin/activities", "POST", {
          title: "整合验收活动",
          category: "walking",
          description: "隔离测试库创建的预约回归活动",
          locationName: "测试公园",
          address: "测试地址",
          visibility: "public",
        }),
        201,
      );
      await read(
        await adminRequest(`/admin/activities/${activity.id}/publish`, "POST", {
          version: activity.version,
        }),
      );
      const now = Date.now(),
        time = (offset: number) => new Date(now + offset).toISOString();
      const slot = await read(
        await adminRequest(`/admin/activities/${activity.id}/slots`, "POST", {
          startAt: time(7200000),
          endAt: time(10800000),
          capacity: 1,
          bookingOpenAt: time(-3600000),
          bookingCloseAt: time(3600000),
          cancelBeforeAt: time(3600000),
        }),
        201,
      );
      const bookingKey = randomUUID(),
        bookingHeaders = {
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": bookingKey,
        };
      const booking = await read(
        await request(
          "/me/bookings",
          "POST",
          { slotId: slot.id, participantVisibility: "public" },
          bookingHeaders,
        ),
        201,
      );
      const replay = await read(
        await request(
          "/me/bookings",
          "POST",
          { slotId: slot.id, participantVisibility: "public" },
          bookingHeaders,
        ),
        201,
      );
      assert.equal(replay.id, booking.id);
      const [slots] = await pool.query<any[]>(
        "SELECT booked_count FROM activity_slots WHERE id=?",
        [slot.id],
      );
      assert.equal(slots[0].booked_count, 1);
      const otherChallenge = await identity.send(
        `m05-other-${randomUUID()}@example.com`,
        "2001:db8::5",
      );
      const other = await identity.login(
        otherChallenge.challengeId,
        code,
        randomUUID(),
        randomUUID(),
      );
      const otherSession = await identity.session(other.access);
      const otherHeaders = {
        Cookie: `qy_access=${other.access}`,
        "X-CSRF-Token": identity.csrf(otherSession.session_id),
        "Idempotency-Key": randomUUID(),
      };
      assert.equal(
        (
          await request(
            "/me/bookings",
            "POST",
            { slotId: slot.id },
            otherHeaders,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/me/bookings/${booking.id}/cancel`,
            "POST",
            { version: booking.version },
            { ...otherHeaders, "Idempotency-Key": randomUUID() },
          )
        ).status,
        404,
      );
      const campaign = await read(
        await adminRequest("/admin/message-campaigns", "POST", {
          title: "整合测试消息",
          body: "统一通知端口验证",
          recipientUserIds: [user.id],
          link: "/messages",
        }),
        201,
      );
      await read(
        await adminRequest(
          `/admin/message-campaigns/${campaign.id}/send`,
          "POST",
          { version: campaign.version },
        ),
        202,
      );
      const { installM05Consumers, processM05Recipients } =
        await import("../src/m05/runtime.js");
      const { dispatchOnce } = await import("../src/common/outbox.js");
      const unregister = await installM05Consumers();
      try {
        for (let i = 0; i < 100; i++) {
          await dispatchOnce();
          const [events] = await pool.query<any[]>(
            "SELECT status FROM outbox_events WHERE aggregate_id=? AND event_type='m05.message.campaign.requested.v1'",
            [campaign.id],
          );
          if (events[0]?.status === "published") break;
        }
        const [published] = await pool.query<any[]>(
          "SELECT status FROM outbox_events WHERE aggregate_id=? AND event_type='m05.message.campaign.requested.v1'",
          [campaign.id],
        );
        assert.equal(
          published[0].status,
          "published",
          "unified dispatcher must pass its current fencing owner to M05",
        );
        await processM05Recipients();
        const inbox = await read(await request("/me/notifications"));
        assert.ok(
          inbox.items.some(
            (item: { title: string }) => item.title === "整合测试消息",
          ),
        );
        const [recipients] = await pool.query<any[]>(
          "SELECT status,notification_id FROM m05_message_recipients WHERE campaign_id=?",
          [campaign.id],
        );
        assert.equal(recipients[0].status, "succeeded");
        assert.ok(recipients[0].notification_id);
      } finally {
        unregister();
      }
      await read(
        await request(
          `/me/bookings/${booking.id}/cancel`,
          "POST",
          { version: booking.version },
          {
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": randomUUID(),
          },
        ),
      );
      const [released] = await pool.query<any[]>(
        "SELECT booked_count FROM activity_slots WHERE id=?",
        [slot.id],
      );
      assert.equal(released[0].booked_count, 0);
      // A disabled referenced user remains lockable for moderation, but cannot act.
      await pool.execute("UPDATE users SET status='disabled' WHERE id=?", [
        otherSession.id,
      ]);
      const { unitOfWorkPort } = await import("../src/common/ports.js");
      assert.equal(
        await unitOfWorkPort.runForUsers(
          user.id,
          [otherSession.id],
          async () => true,
        ),
        true,
      );
      await assert.rejects(
        unitOfWorkPort.runForUsers(
          otherSession.id,
          [user.id],
          async () => true,
        ),
        (error: unknown) =>
          (error as { code: string }).code === "ACCOUNT_DISABLED",
      );
      const dashboard = await request("/me/dashboard");
      assert.equal(dashboard.status, 200);
      assert.equal((await dashboard.json()).data.availability.points, true);
      assert.equal(
        (
          await request(
            "/dev/session",
            "POST",
            { profileKey: "admin" },
            headers,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request("/auth/logout", "POST", {}, headers)).status,
        204,
      );
      assert.equal((await request("/me/points/account")).status, 401);
    } finally {
      for (const rule of ruleRows)
        await pool.execute(
          "UPDATE point_task_definitions SET active=? WHERE code=?",
          [rule.active, rule.code],
        );
      await app.close();
    }
  },
);
