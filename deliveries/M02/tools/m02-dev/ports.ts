/** Explicit M03/M04/M05/M06 TEST adapters. This is not those modules' production implementation. */
import { randomUUID } from "node:crypto";
import type {
  PointAccountDto,
  PointsPort,
  PointsQueryPort,
  NutritionDay,
  TrainingDay,
} from "../../contracts/shared_types";
import type { HealthDependencies } from "../../server/src/modules/health/service";
import { HealthError } from "../../server/src/modules/health/errors";
export function testPorts(): Omit<HealthDependencies, "uow" | "now"> {
  const account: PointsQueryPort["account"] = async (tx, userId) => {
    const [row] = await tx.query<Record<string, unknown>>(
      "SELECT * FROM point_accounts WHERE user_id=?",
      [userId],
    );
    if (!row)
      throw new HealthError(503, "POINTS_NOT_READY", "测试积分账户未初始化");
    return {
      balance: Number(row.balance),
      lifetimeEarned: Number(row.lifetime_earned),
      lifetimeSpent: Number(row.lifetime_spent),
      version: Number(row.version),
    };
  };
  const points: PointsPort = {
    ensureAccountInTransaction: async (tx, { userId }) => account(tx, userId),
    awardInTransaction: async (tx, ctx, input) => {
      if (input.type !== "water_recorded")
        throw new Error("M02 测试适配器只支持饮水");
      const [source] = await tx.query<{
        id: string;
        user_id: string;
        business_date: string;
      }>(
        "SELECT id,user_id,business_date FROM water_records WHERE id=? AND deleted_at IS NULL",
        [input.sourceId],
      );
      if (
        !source ||
        source.user_id !== ctx.userId ||
        source.business_date !== ctx.businessDate
      )
        throw new Error("来源记录校验失败");
      await tx.query(
        "SELECT id FROM point_accounts WHERE user_id=? FOR UPDATE",
        [ctx.userId],
      );
      const existing = await tx.query(
        "SELECT id FROM point_task_awards WHERE user_id=? AND task_code=? AND business_date=? AND scope_key=?",
        [ctx.userId, "daily_water", ctx.businessDate, ""],
      );
      if (existing.length)
        return { awards: [], account: await account(tx, ctx.userId) };
      const id = randomUUID();
      await tx.execute(
        "INSERT INTO point_task_awards (id,user_id,task_code,business_date,scope_key,rule_version,points,source_type,source_id) VALUES (?,?,?,?,?,1,5,?,?)",
        [
          id,
          ctx.userId,
          "daily_water",
          ctx.businessDate,
          "",
          "water_recorded",
          source.id,
        ],
      );
      await tx.execute(
        "UPDATE point_accounts SET balance=balance+5,lifetime_earned=lifetime_earned+5,version=version+1 WHERE user_id=?",
        [ctx.userId],
      );
      const updated = await account(tx, ctx.userId);
      await tx.execute(
        "INSERT INTO point_ledger (id,user_id,delta,balance_after,reason,business_date,business_type,business_id,event_key) VALUES (?,?,5,?,?,?,'task_award',?,?)",
        [
          randomUUID(),
          ctx.userId,
          updated.balance,
          "M02 TEST daily_water",
          ctx.businessDate,
          id,
          `test_award:${id}`,
        ],
      );
      return {
        awards: [
          {
            id,
            taskCode: "daily_water",
            points: 5,
            businessDate: ctx.businessDate,
            scopeKey: "",
          },
        ],
        account: updated,
      };
    },
  };
  return {
    points,
    pointsQuery: {
      account,
      tasks: async (tx, userId, date) => {
        const rows = await tx.query(
          "SELECT id FROM point_task_awards WHERE user_id=? AND business_date=? AND task_code=?",
          [userId, date, "daily_water"],
        );
        return [
          {
            code: "daily_water",
            title: "认真喝水（测试规则）",
            description: "显式测试积分适配器",
            rewardPoints: 5,
            progress: rows.length ? 1 : 0,
            target: 1,
            status: rows.length ? "completed" : "pending",
            completedAt: null,
            action: { type: "navigate", path: "/dashboard" },
          },
        ];
      },
      consecutiveCheckinDays: async () => 0,
    },
    nutrition: { days: async () => [], latestMeal: async () => null },
    training: { days: async () => [], recommendedCourse: async () => null },
    companion: { moods: async () => [] },
    activities: { activeBookingCount: async () => 0 },
  };
}
