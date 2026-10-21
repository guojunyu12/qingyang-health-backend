import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  initializeEmptyDatabase,
  LocalUnitOfWork,
  LocalCommands,
  pool,
  dbName,
} from "./mysql";
import { testPorts } from "./ports";
import { HealthService } from "../../server/src/modules/health/service";
import {
  HealthHttpAdapter,
  type HealthHttpRequest,
} from "../../server/src/modules/health/http";
import { businessDate } from "../../server/src/modules/health/validation";
if (!dbName.startsWith("qingyang_m02_test_"))
  throw new Error("验收只允许新建 qingyang_m02_test_* 专用空库");
const a = "a0000000-0000-4000-8000-000000000001",
  b = "a0000000-0000-4000-8000-000000000002";
const now = new Date(),
  date = businessDate(now),
  yesterday = businessDate(new Date(now.getTime() - 86400000));
const uow = new LocalUnitOfWork(() => now),
  ports = testPorts(),
  service = new HealthService({ ...ports, uow, now: () => now });
const commands = new LocalCommands(uow, () => {}),
  http = new HealthHttpAdapter(service, commands);
const request = (
  method: string,
  path: string,
  body?: unknown,
  user = a,
  key = randomUUID(),
): HealthHttpRequest => ({
  method,
  path: `/api/v1/me/${path}`,
  body,
  identity: { userId: user },
  headers: { "idempotency-key": key },
  query: {},
  params: {},
  requestId: randomUUID(),
});
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${passed}: ${name}`);
}
try {
  await initializeEmptyDatabase();
  await pool.execute(
    "INSERT INTO point_task_definitions (id,code,title,description,reward_points,scope,active,rule_version) VALUES ('f0000000-0000-4000-8000-000000000002','daily_water','认真喝水','M02 TEST',5,'daily',1,1)",
  );
  await check("44 张表与 MySQL 8.4 基线落库", async () => {
    const [tables] = await pool.query("SHOW TABLES");
    assert.equal((tables as unknown[]).length, 44);
  });
  await check("空档案、空累计、空目标与连续日期", async () => {
    const p = await http.handle(request("GET", "health-profile"));
    assert.equal((p.body as { data: null }).data, null);
    const d = await service.dashboard(a, {});
    assert.equal(d.water.totalMl, 0);
    assert.equal(d.water.targetMl, null);
    assert.equal(d.weight.latestKg, null);
    assert.equal((await service.overview(a, { range: 30 })).series.length, 30);
  });
  await check("两个 version=0 并发仅一成功；旧版本 409", async () => {
    const input = {
      targetWeightKg: 60,
      waterTargetMl: 2000,
      calorieTargetKcal: 1800,
      goalType: "balanced",
      version: 0,
    };
    const r = await Promise.all([
      http.handle(request("PUT", "health-profile", input)),
      http.handle(request("PUT", "health-profile", input)),
    ]);
    assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
    const stale = await http.handle(request("PUT", "health-profile", input));
    assert.equal(stale.status, 409);
  });
  await check("首次饮水同事务发奖，同 key 重试只生成一条", async () => {
    const req = request("POST", "water-records", { amountMl: 250 }),
      one = await http.handle(req),
      two = await http.handle(req);
    assert.equal(one.status, 201);
    assert.deepEqual(
      (one.body as { data: unknown }).data,
      (two.body as { data: unknown }).data,
    );
    assert.equal((await service.dashboard(a, {})).water.totalMl, 250);
    assert.equal((await service.dashboard(a, {})).pointsBalance, 5);
    const conflict = await http.handle({ ...req, body: { amountMl: 500 } });
    assert.equal(conflict.status, 409);
  });
  await check("主动两杯创建两条事实，奖励只有一次", async () => {
    assert.equal(
      (await http.handle(request("POST", "water-records", { amountMl: 250 })))
        .status,
      201,
    );
    assert.equal((await service.dashboard(a, {})).water.totalMl, 500);
    assert.equal((await service.dashboard(a, {})).pointsBalance, 5);
  });
  await check("5750 ml 下并发两次 250 ml，最多一成功", async () => {
    for (const amountMl of [1000, 1000, 1000, 1000, 1000, 250])
      await uow.runForUser(a, (tx, ctx) =>
        service.addWater(tx, ctx, { amountMl }),
      );
    const r = await Promise.all([
      http.handle(request("POST", "water-records", { amountMl: 250 })),
      http.handle(request("POST", "water-records", { amountMl: 250 })),
    ]);
    assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
    assert.equal((await service.dashboard(a, {})).water.totalMl, 6000);
  });
  await check("软删除重复 204，跨账号 404，重新添加不再发奖", async () => {
    const list = await uow.readSnapshot((tx) =>
      service.list(tx, a, "water", { date }),
    );
    const id = list.items[0].id;
    assert.equal(
      (
        await http.handle(
          request("DELETE", `water-records/${id}`, undefined, b),
        )
      ).status,
      404,
    );
    assert.equal(
      (await http.handle(request("DELETE", `water-records/${id}`))).status,
      204,
    );
    assert.equal(
      (await http.handle(request("DELETE", `water-records/${id}`))).status,
      204,
    );
    assert.equal(
      (await http.handle(request("POST", "water-records", { amountMl: 1 })))
        .status,
      201,
    );
    assert.equal((await service.dashboard(a, {})).pointsBalance, 5);
  });
  await check(
    "同时间称重 UUID 稳定排序；删最新后回退；他人看不到",
    async () => {
      const recordedAt = now.toISOString();
      const one = await uow.runForUser(a, (tx, ctx) =>
        service.addWeight(tx, ctx, { weightKg: 60, recordedAt }),
      );
      const two = await uow.runForUser(a, (tx, ctx) =>
        service.addWeight(tx, ctx, { weightKg: 61, recordedAt }),
      );
      const sorted = [one, two].sort((x, y) => y.id.localeCompare(x.id));
      assert.equal(
        (await service.dashboard(a, {})).weight.latestKg,
        sorted[0].weightKg,
      );
      await uow.runForUser(a, (tx, ctx) =>
        service.remove(tx, ctx, "weight", sorted[0].id),
      );
      assert.equal(
        (await service.dashboard(a, {})).weight.latestKg,
        sorted[1].weightKg,
      );
      assert.equal((await service.dashboard(b, {})).weight.latestKg, null);
    },
  );
  await check("历史补录保留上海日期、不发奖，均值按有记录天数", async () => {
    const body = { amountMl: 500, recordedAt: `${yesterday}T12:00:00+08:00` };
    const r = await http.handle(request("POST", "water-records", body, b));
    assert.equal(r.status, 201);
    const saved = (
      r.body as {
        data: { record: { businessDate: string }; awards: unknown[] };
      }
    ).data;
    assert.equal(saved.record.businessDate, yesterday);
    assert.equal(saved.awards.length, 0);
    const o = await service.overview(b, {});
    assert.equal(o.summary.avgWaterMl, 500);
    assert.equal(o.coverage.waterDays, 1);
  });
  await check("积分端口失败使饮水事实一起回滚", async () => {
    const broken = new HealthService({
      ...ports,
      uow,
      now: () => now,
      points: {
        ...ports.points,
        awardInTransaction: async () => {
          throw new Error("injected failure");
        },
      },
    });
    await assert.rejects(() =>
      uow.runForUser(b, (tx, ctx) =>
        broken.addWater(tx, ctx, { amountMl: 250 }),
      ),
    );
    assert.equal((await service.dashboard(b, {})).water.totalMl, 0);
  });
  await check("同一快照隔离并发提交；游标不串筛选条件", async () => {
    await uow.readSnapshot(async (tx) => {
      const before = await service.repository.totalWater(tx, b, date);
      await uow.runForUser(b, (other, ctx) =>
        service.addWater(other, ctx, { amountMl: 250 }),
      );
      assert.equal(await service.repository.totalWater(tx, b, date), before);
    });
    const list = await uow.readSnapshot((tx) =>
      service.list(tx, a, "water", { date, limit: 1 }),
    );
    assert.ok(list.nextCursor);
    await assert.rejects(
      () =>
        uow.readSnapshot((tx) =>
          service.list(tx, a, "water", {
            date: yesterday,
            cursor: list.nextCursor,
          }),
        ),
      /游标/,
    );
  });
  console.log(
    `ALL ${passed} MySQL acceptance scenarios passed. TEST cross-module adapters; not a production M01/M05 integration acceptance.`,
  );
} finally {
  await pool.end();
}
