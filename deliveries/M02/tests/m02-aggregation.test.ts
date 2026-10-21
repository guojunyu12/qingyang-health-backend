import { describe, expect, it } from "vitest";
import { HealthService } from "../server/src/modules/health/service";
import type { HealthDependencies } from "../server/src/modules/health/service";
import type { HealthDay, NutritionDay, SqlTx } from "../contracts/shared_types";
const tx: SqlTx = {
  query: async () => [],
  execute: async () => ({ affectedRows: 0 }),
};
function setup(health: HealthDay[] = [], nutrition: NutritionDay[] = []) {
  const seen: SqlTx[] = [];
  const probe =
    <T>(data: T) =>
    async (t: SqlTx) => {
      seen.push(t);
      return data;
    };
  const deps = {
    now: () => new Date("2026-10-19T04:00:00Z"),
    uow: { readSnapshot: async <T>(fn: (tx: SqlTx) => Promise<T>) => fn(tx) },
    nutrition: { days: probe(nutrition), latestMeal: probe(null) },
    training: { days: probe([]), recommendedCourse: probe(null) },
    pointsQuery: {
      account: probe({
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        version: 1,
      }),
      tasks: probe([]),
    },
    companion: { moods: probe([]) },
    activities: { activeBookingCount: probe(0) },
  } as unknown as HealthDependencies;
  const service = new HealthService(deps);
  service.repository.profile = async () => null;
  service.repository.days = async (t) => {
    seen.push(t);
    return health;
  };
  service.repository.latestWeight = async () => null;
  return { service, seen };
}
describe("M02 统计与快照", () => {
  it("新用户连续 30 天日期网格，均值/缺测为空，累计为零", async () => {
    const { service } = setup();
    const dto = await service.overview("user", { range: "30" });
    expect(dto.series).toHaveLength(30);
    expect(dto.series[0].date).toBe("2026-09-20");
    expect(dto.summary.avgWaterMl).toBeNull();
    expect(dto.summary.avgIntakeKcal).toBeNull();
    expect(
      dto.series.every(
        (p) => p.weightKg === null && p.mood === null && p.waterMl === 0,
      ),
    ).toBe(true);
  });
  it("仅两天饮水的均值分母为二，所有端口共用同一事务", async () => {
    const { service, seen } = setup([
      {
        date: "2026-10-18",
        waterMl: 500,
        hasWaterRecord: true,
        weightKg: null,
      },
      { date: "2026-10-19", waterMl: 1000, hasWaterRecord: true, weightKg: 60 },
    ]);
    const dto = await service.overview("user", { range: 7 });
    expect(dto.summary.avgWaterMl).toBe(750);
    expect(dto.coverage.waterDays).toBe(2);
    expect(seen.every((t) => t === tx)).toBe(true);
  });
  it("未知营养保留已知量与完整度，没有目标的预算为 null", async () => {
    const { service } = setup(
      [],
      [
        {
          date: "2026-10-19",
          hasMealRecord: true,
          intakeKcal: 300,
          carbs: { knownG: 10, complete: false },
          protein: { knownG: 8, complete: true },
          fat: { knownG: 0, complete: false },
        },
      ],
    );
    const dto = await service.dashboard("user", {});
    expect(dto.nutrients.carbs).toEqual({
      consumedG: 10,
      targetG: null,
      complete: false,
    });
    expect(dto.energy.remainingKcal).toBeNull();
    expect(dto.energy.intakeKcal).toBe(300);
    expect(dto.weight.latestKg).toBeNull();
  });
  it("拒绝越权输入和无效筛选", async () => {
    const { service } = setup();
    expect(() => service.overview("user", { range: 8 })).toThrow();
    expect(() => service.dashboard("user", { userId: "other" })).toThrow();
  });
});
