import { randomUUID } from "node:crypto";
import type {
  ActivitiesQueryPort,
  CommandContext,
  CompanionQueryPort,
  DashboardDto,
  NutritionQueryPort,
  OverviewDto,
  PointsPort,
  PointsQueryPort,
  SqlTx,
  TrainingQueryPort,
  UnitOfWork,
} from "../../../../contracts/shared_types";
import { HealthError, invalid } from "./errors";
import { HealthRepository, recordDto } from "./repository";
import {
  businessDate,
  parseProfile,
  parseWater,
  parseWeight,
} from "./validation";

export interface HealthDependencies {
  uow: UnitOfWork;
  points: PointsPort;
  nutrition: NutritionQueryPort;
  training: TrainingQueryPort;
  pointsQuery: PointsQueryPort;
  companion: CompanionQueryPort;
  activities: ActivitiesQueryPort;
  now(): Date;
}
export const dateGrid = (end: string, range: number) =>
  Array.from({ length: range }, (_, i) =>
    new Date(Date.parse(end + "T00:00:00Z") - (range - i - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
  );
export function validDate(value: unknown, field = "date"): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    invalid(field, "请输入有效的 YYYY-MM-DD 日期");
  return value;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    invalid("id", "无效的记录 ID");
  return value;
}
function queryOnly(query: Record<string, unknown>, allowed: string[]) {
  for (const k of Object.keys(query))
    if (!allowed.includes(k)) invalid(k, "不允许的查询参数");
}
export class HealthService {
  readonly repository = new HealthRepository();
  constructor(readonly deps: HealthDependencies) {}
  profile(tx: SqlTx, userId: string) {
    return this.repository.profile(tx, userId);
  }
  saveProfile(tx: SqlTx, ctx: CommandContext, input: unknown) {
    return this.repository.saveProfile(
      tx,
      ctx.userId,
      randomUUID(),
      parseProfile(input, new Date(ctx.operationNow)),
      ctx.operationNow,
    );
  }
  async addWater(tx: SqlTx, ctx: CommandContext, input: unknown) {
    const record = {
      id: randomUUID(),
      ...parseWater(input, new Date(ctx.operationNow)),
    };
    const total = await this.repository.totalWater(
      tx,
      ctx.userId,
      record.businessDate,
    );
    if (total + record.amountMl > 6000)
      throw new HealthError(
        409,
        "WATER_DAILY_LIMIT",
        "该日期饮水录入累计不能超过 6000 ml",
      );
    await this.repository.insertWater(tx, ctx.userId, record);
    const awards =
      record.businessDate === ctx.businessDate
        ? (
            await this.deps.points.awardInTransaction(tx, ctx, {
              type: "water_recorded",
              sourceId: record.id,
            })
          ).awards
        : [];
    const profile = await this.repository.profile(tx, ctx.userId);
    const todayTotal =
      record.businessDate === ctx.businessDate
        ? total + record.amountMl
        : await this.repository.totalWater(tx, ctx.userId, ctx.businessDate);
    return {
      record,
      todaySummary: {
        totalMl: todayTotal,
        targetMl: profile?.waterTargetMl ?? null,
        progress: profile ? todayTotal / profile.waterTargetMl : null,
      },
      awards,
    };
  }
  async addWeight(tx: SqlTx, ctx: CommandContext, input: unknown) {
    const record = {
      id: randomUUID(),
      ...parseWeight(input, new Date(ctx.operationNow)),
    };
    await this.repository.insertWeight(tx, ctx.userId, record);
    return record;
  }
  remove(
    tx: SqlTx,
    ctx: CommandContext,
    type: "water" | "weight",
    id: unknown,
  ) {
    return this.repository.remove(
      tx,
      type === "water" ? "water_records" : "weight_records",
      ctx.userId,
      uuid(id),
      ctx.operationNow,
    );
  }
  async list(
    tx: SqlTx,
    userId: string,
    type: "water" | "weight",
    query: Record<string, unknown>,
  ) {
    queryOnly(
      query,
      type === "water"
        ? ["date", "limit", "cursor"]
        : ["startDate", "endDate", "limit", "cursor"],
    );
    const start = validDate(
      type === "water" ? query.date : query.startDate,
      type === "water" ? "date" : "startDate",
    );
    const end = type === "water" ? start : validDate(query.endDate, "endDate");
    if (end < start || Date.parse(end) - Date.parse(start) > 365 * 86400000)
      invalid("endDate", "日期范围最多 366 天且结束日期不能早于开始日期");
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      invalid("limit", "分页大小须为 1–100 的整数");
    const filter = `${type}:${userId}:${start}:${end}`;
    let cursor: { at: string; id: string } | null = null;
    if (query.cursor !== undefined) {
      try {
        if (typeof query.cursor !== "string" || query.cursor.length > 1500)
          throw new Error();
        const decoded = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString(),
        );
        if (
          decoded.filter !== filter ||
          typeof decoded.at !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(decoded.at) ||
          !Number.isFinite(Date.parse(decoded.at))
        )
          throw new Error();
        cursor = { at: decoded.at, id: uuid(decoded.id) };
      } catch {
        invalid("cursor", "游标无效或与当前筛选条件不匹配");
      }
    }
    const table = type === "water" ? "water_records" : "weight_records";
    const rows = await this.repository.list(
      tx,
      table,
      userId,
      start,
      end,
      limit,
      cursor,
    );
    const page = rows.slice(0, limit);
    const items = page.map((row) =>
      table === "water_records"
        ? recordDto("water_records", row)
        : recordDto("weight_records", row),
    );
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ filter, at: last.recordedAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  dashboard(
    userId: string,
    query: Record<string, unknown>,
  ): Promise<DashboardDto> {
    queryOnly(query, ["date", "timezone"]);
    if (query.timezone !== undefined && query.timezone !== "Asia/Shanghai")
      invalid("timezone", "仅支持 Asia/Shanghai");
    const now = this.deps.now();
    const date = validDate(query.date ?? businessDate(now));
    return this.deps.uow.readSnapshot(async (tx) => {
      const profile = await this.repository.profile(tx, userId);
      const grid = dateGrid(date, 7),
        start = grid[0];
      const health = await this.repository.days(tx, userId, start, date);
      const nutrition = await this.deps.nutrition.days(tx, userId, start, date);
      const training = await this.deps.training.days(tx, userId, start, date);
      const todayHealth = health.find((x) => x.date === date),
        meal = nutrition.find((x) => x.date === date),
        workout = training.find((x) => x.date === date);
      const previous = await this.repository.latestWeight(
        tx,
        userId,
        date,
        true,
      );
      const latestKg = todayHealth?.weightKg ?? null;
      const intake = meal?.intakeKcal ?? 0,
        exercise = workout?.exerciseKcal ?? 0;
      const effective = profile ? profile.calorieTargetKcal + exercise : null;
      const nutrient = (
        key: "carbs" | "protein" | "fat",
        target: number | null | undefined,
      ) => ({
        consumedG: meal?.[key].knownG ?? 0,
        targetG: target ?? null,
        complete: meal?.[key].complete ?? true,
      });
      const latestMeal = await this.deps.nutrition.latestMeal(tx, userId, date);
      const recommendedWorkout = await this.deps.training.recommendedCourse(
        tx,
        userId,
        date,
      );
      const account = await this.deps.pointsQuery.account(tx, userId);
      const dailyTasks = await this.deps.pointsQuery.tasks(tx, userId, date);
      return {
        date,
        isDemo: false,
        water: {
          totalMl: todayHealth?.waterMl ?? 0,
          targetMl: profile?.waterTargetMl ?? null,
          progress: profile
            ? (todayHealth?.waterMl ?? 0) / profile.waterTargetMl
            : null,
        },
        weight: {
          latestKg,
          targetKg: profile?.targetWeightKg ?? null,
          previousKg: previous?.weightKg ?? null,
          changeKg:
            latestKg !== null && previous
              ? Math.round((latestKg - previous.weightKg) * 10) / 10
              : null,
          bmi:
            latestKg !== null && profile?.heightCm
              ? Math.round((latestKg / (profile.heightCm / 100) ** 2) * 10) / 10
              : null,
        },
        energy: {
          intakeKcal: intake,
          exerciseKcal: exercise,
          baseTargetKcal: profile?.calorieTargetKcal ?? null,
          effectiveTargetKcal: effective,
          remainingKcal:
            effective === null ? null : Math.max(0, effective - intake),
          exceededKcal:
            effective === null ? null : Math.max(0, intake - effective),
        },
        nutrients: {
          carbs: nutrient("carbs", profile?.carbsTargetG),
          protein: nutrient("protein", profile?.proteinTargetG),
          fat: nutrient("fat", profile?.fatTargetG),
        },
        week: grid.map((d) => ({
          date: d,
          hasMealRecord: nutrition.some((x) => x.date === d && x.hasMealRecord),
          hasTrainingRecord: training.some(
            (x) => x.date === d && x.completedWorkouts > 0,
          ),
        })),
        latestMeal,
        recommendedWorkout,
        pointsBalance: account.balance,
        dailyTasks,
        generatedAt: now.toISOString(),
      };
    });
  }
  overview(
    userId: string,
    query: Record<string, unknown>,
  ): Promise<OverviewDto> {
    queryOnly(query, ["range", "endDate"]);
    const range = query.range === undefined ? 7 : Number(query.range);
    if (range !== 7 && range !== 30) invalid("range", "仅支持近 7 天或 30 天");
    const now = this.deps.now(),
      end = validDate(query.endDate ?? businessDate(now), "endDate");
    const grid = dateGrid(end, range),
      start = grid[0];
    return this.deps.uow.readSnapshot(async (tx) => {
      const health = await this.repository.days(tx, userId, start, end);
      const nutrition = await this.deps.nutrition.days(tx, userId, start, end);
      const training = await this.deps.training.days(tx, userId, start, end);
      const moods = await this.deps.companion.moods(tx, userId, start, end);
      const latest = await this.repository.latestWeight(tx, userId, end);
      const account = await this.deps.pointsQuery.account(tx, userId);
      const activeBookings = await this.deps.activities.activeBookingCount(
        tx,
        userId,
        now.toISOString(),
      );
      const series = grid.map((date) => {
        const h = health.find((x) => x.date === date),
          n = nutrition.find((x) => x.date === date),
          t = training.find((x) => x.date === date),
          m = moods.find((x) => x.date === date);
        return {
          date,
          intakeKcal: n?.intakeKcal ?? 0,
          exerciseKcal: t?.exerciseKcal ?? 0,
          waterMl: h?.waterMl ?? 0,
          weightKg: h?.weightKg ?? null,
          mood: m?.mood ?? null,
          completedWorkouts: t?.completedWorkouts ?? 0,
          hasMealRecord: n?.hasMealRecord ?? false,
          hasWaterRecord: h?.hasWaterRecord ?? false,
        };
      });
      const mealDays = series.filter((x) => x.hasMealRecord),
        waterDays = series.filter((x) => x.hasWaterRecord);
      const avg = (values: number[]) =>
        values.length
          ? Math.round(
              (values.reduce((a, b) => a + b, 0) / values.length) * 10,
            ) / 10
          : null;
      return {
        range,
        startDate: start,
        endDate: end,
        generatedAt: now.toISOString(),
        summary: {
          avgIntakeKcal: avg(mealDays.map((x) => x.intakeKcal)),
          avgWaterMl: avg(waterDays.map((x) => x.waterMl)),
          completedWorkouts: series.reduce(
            (a, x) => a + x.completedWorkouts,
            0,
          ),
          totalExerciseKcal: series.reduce((a, x) => a + x.exerciseKcal, 0),
          latestWeightKg: latest?.weightKg ?? null,
          moodRecordedDays: series.filter((x) => x.mood !== null).length,
          pointsBalance: account.balance,
          activeBookings,
        },
        series,
        coverage: {
          mealDays: mealDays.length,
          waterDays: waterDays.length,
          weightDays: series.filter((x) => x.weightKg !== null).length,
          moodDays: series.filter((x) => x.mood !== null).length,
          rangeDays: range,
        },
      };
    });
  }
}
