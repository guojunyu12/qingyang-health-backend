import type {
  DbParam,
  HealthDay,
  HealthProfileDto,
  HealthProfileInput,
  HealthQueryPort,
  SqlTx,
  WaterRecordDto,
  WeightRecordDto,
} from "../../../../contracts/shared_types";
import { HealthError } from "./errors";

type Row = Record<string, unknown>;
const iso = (value: unknown) =>
  value instanceof Date
    ? value.toISOString()
    : new Date(
        String(value).replace(" ", "T") + (/Z$/.test(String(value)) ? "" : "Z"),
      ).toISOString();
export function profileDto(row: Row): HealthProfileDto {
  const nullable = (key: string) =>
    row[key] == null ? null : Number(row[key]);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    heightCm: nullable("height_cm"),
    birthYear: nullable("birth_year"),
    targetWeightKg: Number(row.target_weight_kg),
    waterTargetMl: Number(row.water_target_ml),
    calorieTargetKcal: Number(row.calorie_target_kcal),
    carbsTargetG: nullable("carbs_target_g"),
    proteinTargetG: nullable("protein_target_g"),
    fatTargetG: nullable("fat_target_g"),
    goalType: row.goal_type as HealthProfileDto["goalType"],
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
  };
}
export function recordDto(table: "water_records", row: Row): WaterRecordDto;
export function recordDto(table: "weight_records", row: Row): WeightRecordDto;
export function recordDto(
  table: "water_records" | "weight_records",
  row: Row,
): WaterRecordDto | WeightRecordDto {
  const common = {
    id: String(row.id),
    recordedAt: iso(row.recorded_at),
    businessDate: String(row.business_date),
    source: "manual" as const,
  };
  return table === "water_records"
    ? { ...common, amountMl: Number(row.amount_ml) }
    : { ...common, weightKg: Number(row.weight_kg) };
}
export const mysqlInstant = (value: string) =>
  value.replace("T", " ").replace("Z", "");
export class HealthRepository implements HealthQueryPort {
  async profile(tx: SqlTx, userId: string) {
    const [row] = await tx.query<Row>(
      "SELECT * FROM health_profiles WHERE user_id=?",
      [userId],
    );
    return row ? profileDto(row) : null;
  }
  async saveProfile(
    tx: SqlTx,
    userId: string,
    id: string,
    input: HealthProfileInput,
    now: string,
  ) {
    const values: DbParam[] = [
      input.heightCm ?? null,
      input.birthYear ?? null,
      input.targetWeightKg,
      input.waterTargetMl,
      input.calorieTargetKcal,
      input.carbsTargetG ?? null,
      input.proteinTargetG ?? null,
      input.fatTargetG ?? null,
      input.goalType,
    ];
    if (input.version === 0) {
      if (await this.profile(tx, userId))
        throw new HealthError(
          409,
          "VERSION_CONFLICT",
          "档案已创建，请重新加载后保存",
        );
      try {
        await tx.execute(
          "INSERT INTO health_profiles (id,user_id,height_cm,birth_year,target_weight_kg,water_target_ml,calorie_target_kcal,carbs_target_g,protein_target_g,fat_target_g,goal_type,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
          [id, userId, ...values, mysqlInstant(now), mysqlInstant(now)],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "ER_DUP_ENTRY")
          throw new HealthError(
            409,
            "VERSION_CONFLICT",
            "档案已创建，请重新加载后保存",
          );
        throw error;
      }
    } else {
      const result = await tx.execute(
        "UPDATE health_profiles SET height_cm=?,birth_year=?,target_weight_kg=?,water_target_ml=?,calorie_target_kcal=?,carbs_target_g=?,protein_target_g=?,fat_target_g=?,goal_type=?,version=version+1,updated_at=? WHERE user_id=? AND version=?",
        [...values, mysqlInstant(now), userId, input.version],
      );
      if (!result.affectedRows)
        throw new HealthError(
          409,
          "VERSION_CONFLICT",
          "档案已更新，请重新加载后保存",
        );
    }
    return (await this.profile(tx, userId))!;
  }
  async days(
    tx: SqlTx,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<HealthDay[]> {
    const water = await tx.query<Row>(
      "SELECT business_date, SUM(amount_ml) AS total FROM water_records WHERE user_id=? AND deleted_at IS NULL AND business_date BETWEEN ? AND ? GROUP BY business_date",
      [userId, startDate, endDate],
    );
    const weights = await tx.query<Row>(
      "SELECT business_date,weight_kg FROM (SELECT business_date,weight_kg,ROW_NUMBER() OVER(PARTITION BY business_date ORDER BY recorded_at DESC,id DESC) AS rn FROM weight_records WHERE user_id=? AND deleted_at IS NULL AND business_date BETWEEN ? AND ?) ranked WHERE rn=1",
      [userId, startDate, endDate],
    );
    const days = new Map<string, HealthDay>();
    for (const w of water)
      days.set(String(w.business_date), {
        date: String(w.business_date),
        waterMl: Number(w.total),
        hasWaterRecord: true,
        weightKg: null,
      });
    for (const w of weights) {
      const date = String(w.business_date);
      days.set(date, {
        ...(days.get(date) ?? { date, waterMl: 0, hasWaterRecord: false }),
        weightKg: Number(w.weight_kg),
      });
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  async latestWeight(tx: SqlTx, userId: string, date: string, before = false) {
    const [row] = await tx.query<Row>(
      `SELECT * FROM weight_records WHERE user_id=? AND deleted_at IS NULL AND business_date ${before ? "<" : "<="} ? ORDER BY recorded_at DESC,id DESC LIMIT 1`,
      [userId, date],
    );
    return row ? recordDto("weight_records", row) : null;
  }
  async totalWater(tx: SqlTx, userId: string, date: string) {
    const [row] = await tx.query<Row>(
      "SELECT COALESCE(SUM(amount_ml),0) AS total FROM water_records WHERE user_id=? AND business_date=? AND deleted_at IS NULL",
      [userId, date],
    );
    return Number(row.total);
  }
  async insertWater(tx: SqlTx, userId: string, record: WaterRecordDto) {
    await tx.execute(
      "INSERT INTO water_records (id,user_id,amount_ml,recorded_at,business_date,source) VALUES (?,?,?,?,?,?)",
      [
        record.id,
        userId,
        record.amountMl,
        mysqlInstant(record.recordedAt),
        record.businessDate,
        "manual",
      ],
    );
  }
  async insertWeight(tx: SqlTx, userId: string, record: WeightRecordDto) {
    await tx.execute(
      "INSERT INTO weight_records (id,user_id,weight_kg,recorded_at,business_date,source) VALUES (?,?,?,?,?,?)",
      [
        record.id,
        userId,
        record.weightKg,
        mysqlInstant(record.recordedAt),
        record.businessDate,
        "manual",
      ],
    );
  }
  async remove(
    tx: SqlTx,
    table: "water_records" | "weight_records",
    userId: string,
    id: string,
    now: string,
  ) {
    const [row] = await tx.query<Row>(
      `SELECT id,deleted_at FROM ${table} WHERE id=? AND user_id=? FOR UPDATE`,
      [id, userId],
    );
    if (!row) throw new HealthError(404, "NOT_FOUND", "记录不存在");
    if (!row.deleted_at)
      await tx.execute(
        `UPDATE ${table} SET deleted_at=?,updated_at=? WHERE id=? AND user_id=?`,
        [mysqlInstant(now), mysqlInstant(now), id, userId],
      );
  }
  async list(
    tx: SqlTx,
    table: "water_records" | "weight_records",
    userId: string,
    start: string,
    end: string,
    limit: number,
    cursor: { at: string; id: string } | null,
  ) {
    const values: DbParam[] = [userId, start, end];
    let after = "";
    if (cursor) {
      after = " AND (recorded_at < ? OR (recorded_at=? AND id < ?))";
      values.push(mysqlInstant(cursor.at), mysqlInstant(cursor.at), cursor.id);
    }
    values.push(limit + 1);
    return tx.query<Row>(
      `SELECT * FROM ${table} WHERE user_id=? AND deleted_at IS NULL AND business_date BETWEEN ? AND ?${after} ORDER BY recorded_at DESC,id DESC LIMIT ?`,
      values,
    );
  }
}
