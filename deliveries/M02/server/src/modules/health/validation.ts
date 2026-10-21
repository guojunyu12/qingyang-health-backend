import type { HealthProfileInput } from "../../../../contracts/shared_types";

export class HealthInputError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 422;
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}
function fail(field: string, message: string): never {
  throw new HealthInputError(field, message);
}
function object(input: unknown, allowed: string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    fail("body", "请求必须为对象");
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(key, "不允许的字段");
  return value;
}
function number(
  value: unknown,
  field: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(field, `请输入 ${min}–${max} 之间的数字`);
  if (
    integer
      ? !Number.isInteger(value)
      : Math.abs(value * 10 - Math.round(value * 10)) > 1e-9
  )
    fail(field, integer ? "请输入整数" : "最多保留一位小数");
  return value;
}
export function businessDate(instant: Date): string {
  return new Date(instant.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function parseProfile(
  input: unknown,
  operationNow: Date,
): HealthProfileInput {
  const v = object(input, [
    "heightCm",
    "birthYear",
    "targetWeightKg",
    "waterTargetMl",
    "calorieTargetKcal",
    "carbsTargetG",
    "proteinTargetG",
    "fatTargetG",
    "goalType",
    "version",
  ]);
  const optional = (
    field: string,
    min: number,
    max: number,
    integer = false,
  ) => (v[field] == null ? null : number(v[field], field, min, max, integer));
  if (!["balanced", "maintain", "lose", "gain"].includes(v.goalType as string))
    fail("goalType", "请选择健康目标");
  return {
    heightCm: optional("heightCm", 50, 250),
    birthYear: optional(
      "birthYear",
      1900,
      Number(businessDate(operationNow).slice(0, 4)),
      true,
    ),
    targetWeightKg: number(v.targetWeightKg, "targetWeightKg", 20, 350),
    waterTargetMl: number(v.waterTargetMl, "waterTargetMl", 500, 6000, true),
    calorieTargetKcal: number(
      v.calorieTargetKcal,
      "calorieTargetKcal",
      800,
      5000,
    ),
    carbsTargetG: optional("carbsTargetG", 0, 1000),
    proteinTargetG: optional("proteinTargetG", 0, 1000),
    fatTargetG: optional("fatTargetG", 0, 1000),
    goalType: v.goalType as HealthProfileInput["goalType"],
    version: number(v.version, "version", 0, 2147483646, true),
  };
}
export function parseRecordedAt(
  value: unknown,
  operationNow: Date,
): { recordedAt: string; businessDate: string } {
  let at = operationNow;
  if (value !== undefined) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
        value,
      )
    )
      fail("recordedAt", "时间必须包含明确时区");
    const calendar = value.slice(0, 10);
    if (
      !Number.isFinite(Date.parse(calendar)) ||
      new Date(calendar).toISOString().slice(0, 10) !== calendar
    )
      fail("recordedAt", "无效日期");
    at = new Date(value);
  }
  if (
    !Number.isFinite(at.getTime()) ||
    at.getTime() > operationNow.getTime() ||
    at.getTime() < operationNow.getTime() - 30 * 86400000
  )
    fail("recordedAt", "仅允许记录当前时刻之前 30 天内的时间");
  return { recordedAt: at.toISOString(), businessDate: businessDate(at) };
}
export function parseWater(input: unknown, operationNow: Date) {
  const v = object(input, ["amountMl", "recordedAt", "source"]);
  if (v.source !== undefined && v.source !== "manual")
    fail("source", "仅支持手动录入");
  return {
    amountMl: number(v.amountMl, "amountMl", 1, 1000, true),
    source: "manual" as const,
    ...parseRecordedAt(v.recordedAt, operationNow),
  };
}
export function parseWeight(input: unknown, operationNow: Date) {
  const v = object(input, ["weightKg", "recordedAt", "source"]);
  if (v.source !== undefined && v.source !== "manual")
    fail("source", "仅支持手动录入");
  return {
    weightKg: number(v.weightKg, "weightKg", 20, 350),
    source: "manual" as const,
    ...parseRecordedAt(v.recordedAt, operationNow),
  };
}
