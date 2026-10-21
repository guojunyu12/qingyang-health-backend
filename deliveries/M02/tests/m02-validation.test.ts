import { describe, expect, it } from "vitest";
import {
  parseProfile,
  parseWater,
  parseWeight,
} from "../server/src/modules/health/validation";
const now = new Date("2026-10-19T00:00:00.000Z");
const profile = {
  targetWeightKg: 60,
  waterTargetMl: 2000,
  calorieTargetKcal: 1800,
  goalType: "balanced",
  version: 0,
};
describe("M02 输入边界", () => {
  it("完整 PUT 将省略可选字段置空", () => {
    expect(parseProfile(profile, now)).toMatchObject({
      heightCm: null,
      birthYear: null,
      carbsTargetG: null,
      version: 0,
    });
  });
  it("拒绝只读字段及客户端身份", () => {
    expect(() =>
      parseWater({ amountMl: 250, userId: "another-user" }, now),
    ).toThrow();
    expect(() =>
      parseProfile({ ...profile, currentWeight: 60 }, now),
    ).toThrow();
  });
  it("拒绝数据库可能舍入的小数与未来出生年份", () => {
    expect(() => parseWeight({ weightKg: 60.15 }, now)).toThrow();
    expect(() => parseProfile({ ...profile, birthYear: 2027 }, now)).toThrow();
  });
  it("上海午夜前后归属不同业务日，等价时区归属相同日期", () => {
    expect(
      parseWater({ amountMl: 250, recordedAt: "2026-10-18T15:59:59Z" }, now)
        .businessDate,
    ).toBe("2026-10-18");
    expect(
      parseWater({ amountMl: 250, recordedAt: "2026-10-18T16:00:00Z" }, now)
        .businessDate,
    ).toBe("2026-10-19");
    expect(
      parseWater(
        { amountMl: 250, recordedAt: "2026-10-19T00:00:00+08:00" },
        now,
      ).recordedAt,
    ).toBe("2026-10-18T16:00:00.000Z");
  });
  it("拒绝无时区、无效日期、未来或过期补录", () => {
    for (const recordedAt of [
      "2026-10-18T12:00:00",
      "2026-02-30T00:00:00Z",
      "2026-10-20T00:00:00Z",
      "2026-09-18T00:00:00Z",
    ]) {
      expect(() => parseWater({ amountMl: 250, recordedAt }, now)).toThrow();
    }
  });
  it("30 天边界可录入，单次饮水最大 1000 ml", () => {
    expect(
      parseWater({ amountMl: 1000, recordedAt: "2026-09-19T00:00:00Z" }, now)
        .amountMl,
    ).toBe(1000);
    expect(() => parseWater({ amountMl: 1001 }, now)).toThrow();
  });
});
