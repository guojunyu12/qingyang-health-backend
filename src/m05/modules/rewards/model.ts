import type { SqlTx } from "../../../../contracts/shared_types.js";
import { requireValue } from "../../common/errors.js";
import { uuid, asInstant } from "../activities/model.js";
import type { RewardProvider } from "./provider.js";
export const MAX = 2147483647;
export const bounded = (n: number) => {
  requireValue(
    Number.isSafeInteger(n) && n >= 0 && n <= MAX,
    409,
    "INTEGER_OVERFLOW",
    "积分或库存累计已到上限，请联系运营核对",
  );
  return n;
};
export interface RewardRow {
  id: string;
  title: string;
  description: string;
  image_asset_id: string | null;
  cost_points: number;
  stock: number;
  daily_limit: number;
  fulfillment_type: "digital";
  status: "draft" | "published" | "archived";
  version: number;
  created_at: string;
}
export interface RedemptionRow {
  id: string;
  user_id: string;
  reward_id: string;
  reward_title_snapshot: string;
  reward_version_snapshot: number;
  cost_points: number;
  business_date: string;
  status: "pending" | "fulfilled" | "failed" | "refunded";
  fulfillment_status: "pending" | "processing" | "succeeded" | "failed";
  fulfilled_at: string | null;
  redeem_code_ciphertext: string | null;
  version: number;
  created_at: string;
}
export interface AccountRow {
  balance: number;
  lifetime_earned: number;
  lifetime_spent: number;
  version: number;
}
export async function reward(tx: SqlTx, id: string, lock = false) {
  const [r] = await tx.query<RewardRow>(
    "SELECT * FROM point_rewards WHERE id=?" + (lock ? " FOR UPDATE" : ""),
    [uuid(id)],
  );
  requireValue(r, 404, "REWARD_NOT_FOUND", "权益不存在");
  return r;
}
export async function redemption(
  tx: SqlTx,
  id: string,
  owner?: string,
  lock = false,
) {
  const [r] = await tx.query<RedemptionRow>(
    "SELECT * FROM point_redemptions WHERE id=?" +
      (owner ? " AND user_id=?" : "") +
      (lock ? " FOR UPDATE" : ""),
    owner ? [uuid(id), owner] : [uuid(id)],
  );
  requireValue(r, 404, "REDEMPTION_NOT_FOUND", "兑换记录不存在");
  return r;
}
export async function account(tx: SqlTx, userId: string) {
  const [a] = await tx.query<AccountRow>(
    "SELECT * FROM point_accounts WHERE user_id=? FOR UPDATE",
    [userId],
  );
  requireValue(a, 503, "POINT_ACCOUNT_NOT_INITIALIZED", "积分账户尚未初始化");
  return a;
}
export const rewardDto = (r: RewardRow, provider: RewardProvider) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  imageAssetId: r.image_asset_id,
  imageUrl: null,
  costPoints: r.cost_points,
  stock: r.stock,
  dailyLimit: r.daily_limit,
  fulfillmentType: r.fulfillment_type,
  status: r.status,
  version: r.version,
  createdAt: asInstant(r.created_at),
  providerMode: provider.mode,
  available: provider.ready(r.id),
  testOnly: provider.mode === "development",
});
export const redemptionDto = (r: RedemptionRow) => ({
  id: r.id,
  rewardId: r.reward_id,
  rewardTitle: r.reward_title_snapshot,
  rewardVersionSnapshot: r.reward_version_snapshot,
  costPoints: r.cost_points,
  businessDate: r.business_date,
  status: r.status,
  fulfillmentStatus: r.fulfillment_status,
  fulfilledAt: r.fulfilled_at ? asInstant(r.fulfilled_at) : null,
  version: r.version,
  createdAt: asInstant(r.created_at),
});
