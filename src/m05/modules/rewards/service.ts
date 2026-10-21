import { randomUUID } from "node:crypto";
import type {
  SqlTx,
  CommandContext,
  MediaPort,
} from "../../../../contracts/shared_types.js";
import { exactBody, requireValue } from "../../common/errors.js";
import { LocalAudit, LocalOutbox } from "../../common/ports.js";
import {
  uuid,
  int,
  textValue,
  version,
  asInstant,
} from "../activities/model.js";
import { accountDto } from "../points/points.js";
import { RewardProvider, CodeVault, ProviderResult } from "./provider.js";
import {
  MAX,
  bounded,
  reward,
  redemption,
  account,
  RewardRow,
  RedemptionRow,
  rewardDto,
  redemptionDto,
} from "./model.js";
export class RewardsService {
  constructor(
    readonly provider: RewardProvider,
    readonly vault: CodeVault,
    private media?: MediaPort,
    private checkpoint?: (point: string) => void,
  ) {}
  async admin(tx: SqlTx, id: string) {
    requireValue(
      (
        await tx.query("SELECT id FROM user_roles WHERE user_id=? AND role=?", [
          id,
          "admin",
        ])
      ).length,
      403,
      "ADMIN_REQUIRED",
      "需要管理员权限",
    );
  }
  async save(
    tx: SqlTx,
    ctx: CommandContext,
    body: Record<string, unknown>,
    id?: string,
  ) {
    await this.admin(tx, ctx.userId);
    exactBody(body, [
      "title",
      "description",
      "imageAssetId",
      "costPoints",
      "stock",
      "dailyLimit",
      "fulfillmentType",
      ...(id ? ["version"] : []),
    ]);
    const old = id ? await reward(tx, id, true) : null;
    if (old) {
      version(old.version, body.version);
      requireValue(
        old.status !== "archived",
        409,
        "REWARD_ARCHIVED",
        "归档权益不可编辑",
      );
      bounded(old.version + 1);
    }
    const value = (k: string, prior: unknown, fallback?: unknown) =>
      body[k] === undefined ? (old ? prior : fallback) : body[k];
    const title = textValue(value("title", old?.title), 100),
      description = textValue(value("description", old?.description), 10000),
      cost = int(value("costPoints", old?.cost_points), 1, MAX),
      stock = int(value("stock", old?.stock, 0), 0, MAX),
      limit = int(value("dailyLimit", old?.daily_limit, 1), 1, MAX),
      type = value("fulfillmentType", old?.fulfillment_type, "digital"),
      image = value("imageAssetId", old?.image_asset_id, null);
    requireValue(type === "digital", 422, "DIGITAL_ONLY", "仅支持数字权益");
    if (image !== null) {
      uuid(image);
      requireValue(
        this.media,
        503,
        "MEDIA_NOT_CONFIGURED",
        "素材端口尚未接入，可先不设置封面",
      );
      await this.media.assertReady(tx, {
        assetId: image as string,
        purpose: "reward_image",
        actorUserId: ctx.userId,
        access: "admin_material",
      });
    }
    const rewardId = id || randomUUID();
    if (old)
      await tx.execute(
        "UPDATE point_rewards SET title=?,description=?,image_asset_id=?,cost_points=?,stock=?,daily_limit=?,version=version+1 WHERE id=?",
        [
          title,
          description,
          image as string | null,
          cost,
          stock,
          limit,
          rewardId,
        ],
      );
    else
      await tx.execute(
        "INSERT INTO point_rewards (id,title,description,image_asset_id,cost_points,stock,daily_limit) VALUES (?,?,?,?,?,?,?)",
        [
          rewardId,
          title,
          description,
          image as string | null,
          cost,
          stock,
          limit,
        ],
      );
    const updated = await reward(tx, rewardId);
    await new LocalAudit().record(
      tx,
      ctx,
      old ? "reward.updated" : "reward.created",
      "point_rewards",
      rewardId,
      {
        before: old ? rewardDto(old, this.provider) : null,
        after: rewardDto(updated, this.provider),
      },
    );
    return rewardDto(updated, this.provider);
  }
  async lifecycle(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
    archive = false,
  ) {
    await this.admin(tx, ctx.userId);
    exactBody(body, ["version"]);
    const r = await reward(tx, id, true);
    version(r.version, body.version);
    if (archive && r.status === "archived") return rewardDto(r, this.provider);
    requireValue(
      r.status !== "archived",
      409,
      "REWARD_ARCHIVED",
      "归档权益不能发布",
    );
    if (!archive) {
      requireValue(
        this.provider.ready(id) && this.vault.ready,
        503,
        "PROVIDER_UNAVAILABLE",
        "履约供应商或兑换码加密配置未就绪，不能发布",
      );
      if (r.image_asset_id) {
        requireValue(
          this.media,
          503,
          "MEDIA_NOT_CONFIGURED",
          "素材端口尚未接入",
        );
        await this.media.assertReady(tx, {
          assetId: r.image_asset_id,
          purpose: "reward_image",
          actorUserId: ctx.userId,
          access: "admin_material",
        });
      }
      if (r.status === "published") return rewardDto(r, this.provider);
    }
    bounded(r.version + 1);
    await tx.execute(
      "UPDATE point_rewards SET status=?,version=version+1 WHERE id=?",
      [archive ? "archived" : "published", id],
    );
    await new LocalAudit().record(
      tx,
      ctx,
      archive ? "reward.archived" : "reward.published",
      "point_rewards",
      id,
      { version: r.version + 1 },
    );
    return rewardDto(await reward(tx, id), this.provider);
  }
  async redeem(tx: SqlTx, ctx: CommandContext, body: Record<string, unknown>) {
    exactBody(body, ["rewardId", "quantity", "expectedRewardVersion"]);
    const id = uuid(body.rewardId);
    requireValue(
      body.quantity === undefined || body.quantity === 1,
      422,
      "QUANTITY_ONE_ONLY",
      "每次只能兑换 1 份",
    );
    int(body.expectedRewardVersion);
    const a = await account(tx, ctx.userId),
      r = await reward(tx, id, true);
    requireValue(
      r.version === body.expectedRewardVersion,
      409,
      "REWARD_CHANGED",
      "权益内容、价格或库存已变化，请重新查看并确认",
    );
    requireValue(
      r.status === "published",
      409,
      "REWARD_UNAVAILABLE",
      "权益当前不可兑换",
    );
    requireValue(
      this.provider.ready(id) && this.vault.ready,
      503,
      "PROVIDER_UNAVAILABLE",
      "数字权益供应商未就绪，尚未扣分",
    );
    const [daily] = await tx.query<{ n: number }>(
      "SELECT COUNT(*) n FROM point_redemptions WHERE user_id=? AND reward_id=? AND business_date=?",
      [ctx.userId, id, ctx.businessDate],
    );
    requireValue(
      daily.n < r.daily_limit,
      409,
      "DAILY_LIMIT_REACHED",
      "今日兑换次数已达上限，退款订单也计入次数",
    );
    requireValue(
      a.balance >= r.cost_points,
      409,
      "INSUFFICIENT_POINTS",
      "积分不足，请先完成积分任务",
    );
    requireValue(r.stock > 0, 409, "OUT_OF_STOCK", "库存已兑完");
    bounded(a.lifetime_spent + r.cost_points);
    bounded(a.version + 1);
    bounded(r.version + 1);
    const orderId = randomUUID();
    await tx.execute(
      "UPDATE point_accounts SET balance=balance-?,lifetime_spent=lifetime_spent+?,version=version+1 WHERE user_id=?",
      [r.cost_points, r.cost_points, ctx.userId],
    );
    await tx.execute(
      "UPDATE point_rewards SET stock=stock-1,version=version+1 WHERE id=?",
      [id],
    );
    this.checkpoint?.("after_debit");
    await tx.execute(
      "INSERT INTO point_redemptions (id,user_id,reward_id,reward_title_snapshot,reward_version_snapshot,cost_points,business_date) VALUES (?,?,?,?,?,?,?)",
      [
        orderId,
        ctx.userId,
        id,
        r.title,
        r.version,
        r.cost_points,
        ctx.businessDate,
      ],
    );
    this.checkpoint?.("after_order");
    await tx.execute(
      "INSERT INTO point_ledger (id,user_id,delta,balance_after,reason,business_date,business_type,business_id,event_key) VALUES (?,?,?,?,?,?,'redemption',?,?)",
      [
        randomUUID(),
        ctx.userId,
        -r.cost_points,
        a.balance - r.cost_points,
        "兑换：" + r.title,
        ctx.businessDate,
        orderId,
        "redemption:" + orderId,
      ],
    );
    this.checkpoint?.("after_ledger");
    await new LocalOutbox().enqueueInTransaction(tx, {
      eventType: "points.redemption.requested.v1",
      aggregateType: "point_redemption",
      aggregateId: orderId,
      eventKey: "points.redemption.requested.v1:" + orderId,
      schemaVersion: 1,
      payload: { redemptionId: orderId, userId: ctx.userId },
    });
    this.checkpoint?.("after_outbox");
    return {
      ...redemptionDto(await redemption(tx, orderId)),
      account: accountDto(await account(tx, ctx.userId)),
      testOnly: this.provider.mode === "development",
    };
  }
  /** Caller holds user then redemption locks. Finality proof is supplied only by the trusted provider adapter. */
  async finish(
    tx: SqlTx,
    r: RedemptionRow,
    result: Exclude<ProviderResult, { status: "unknown" }>,
    now: string,
  ) {
    requireValue(
      r.status === "pending" && r.fulfillment_status === "processing",
      409,
      "REDEMPTION_FINAL",
      "订单状态已变化",
    );
    bounded(r.version + 1);
    if (result.status === "succeeded") {
      const ciphertext = this.vault.encrypt(result.code, r.id, r.user_id);
      await tx.execute(
        "UPDATE point_redemptions SET status='fulfilled',fulfillment_status='succeeded',fulfilled_at=?,redeem_code_ciphertext=?,version=version+1 WHERE id=? AND version=? AND status='pending'",
        [new Date(now), ciphertext, r.id, r.version],
      );
    } else {
      const a = await account(tx, r.user_id),
        item = await reward(tx, r.reward_id, true);
      const [debit] = await tx.query<{
        id: string;
        delta: number;
        business_id: string;
      }>(
        "SELECT id,delta,business_id FROM point_ledger WHERE user_id=? AND business_type=? AND business_id=? AND event_key=?",
        [r.user_id, "redemption", r.id, "redemption:" + r.id],
      );
      requireValue(
        debit && debit.delta === -r.cost_points && debit.business_id === r.id,
        409,
        "DEBIT_MISMATCH",
        "原扣分流水不匹配，暂停补偿",
      );
      requireValue(
        !(
          await tx.query("SELECT id FROM point_ledger WHERE reversal_of=?", [
            debit.id,
          ])
        ).length,
        409,
        "REFUND_ALREADY_EXISTS",
        "退款流水已存在，需核对状态",
      );
      bounded(a.balance + r.cost_points);
      bounded(a.lifetime_earned + r.cost_points);
      bounded(a.version + 1);
      bounded(item.stock + 1);
      bounded(item.version + 1);
      await tx.execute(
        "UPDATE point_accounts SET balance=balance+?,lifetime_earned=lifetime_earned+?,version=version+1 WHERE user_id=?",
        [r.cost_points, r.cost_points, r.user_id],
      );
      await tx.execute(
        "UPDATE point_rewards SET stock=stock+1,version=version+1 WHERE id=?",
        [r.reward_id],
      );
      this.checkpoint?.("after_refund_account");
      await tx.execute(
        "INSERT INTO point_ledger (id,user_id,delta,balance_after,reason,business_date,business_type,business_id,event_key,reversal_of) VALUES (?,?,?,?,?,?,'redemption_refund',?,?,?)",
        [
          randomUUID(),
          r.user_id,
          r.cost_points,
          a.balance + r.cost_points,
          "兑换退款：" + r.reward_title_snapshot,
          new Date(Date.parse(now) + 8 * 3600000).toISOString().slice(0, 10),
          r.id,
          "redemption_refund:" + r.id,
          debit.id,
        ],
      );
      this.checkpoint?.("after_refund_ledger");
      await tx.execute(
        "UPDATE point_redemptions SET status='refunded',fulfillment_status='failed',fulfilled_at=NULL,redeem_code_ciphertext=NULL,version=version+1 WHERE id=? AND version=? AND status='pending'",
        [r.id, r.version],
      );
    }
    const status = result.status === "succeeded" ? "fulfilled" : "refunded";
    await new LocalOutbox().enqueueInTransaction(tx, {
      eventType: "points.redemption.finished.v1",
      aggregateType: "point_redemption",
      aggregateId: r.id,
      eventKey: `points.redemption.finished.v1:${r.id}:${r.version + 1}:${status}`,
      schemaVersion: 1,
      payload: {
        redemptionId: r.id,
        userId: r.user_id,
        redemptionVersion: r.version + 1,
        status,
      },
    });
    this.checkpoint?.("after_finish_outbox");
    return redemptionDto(await redemption(tx, r.id));
  }
  async scheduleReconcile(
    tx: SqlTx,
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) {
    await this.admin(tx, ctx.userId);
    exactBody(body, ["version"]);
    const r = await redemption(tx, id, undefined, true);
    version(r.version, body.version);
    requireValue(
      r.status === "pending",
      409,
      "REDEMPTION_FINAL",
      "订单已结束，无需再次履约",
    );
    requireValue(
      this.provider.ready(r.reward_id),
      503,
      "PROVIDER_UNAVAILABLE",
      "供应商未配置，无法查询结果",
    );
    const changed = await tx.execute(
      "UPDATE outbox_events SET next_attempt_at=UTC_TIMESTAMP(3),status='pending',locked_by=NULL,locked_until=NULL,published_at=NULL WHERE event_key=? AND (status IN ('pending','failed') OR (status='processing' AND locked_until<=UTC_TIMESTAMP(3)))",
      ["points.redemption.requested.v1:" + id],
    );
    requireValue(
      changed.affectedRows === 1,
      409,
      "FULFILLMENT_IN_PROGRESS",
      "已有执行器正在处理，请稍后刷新",
    );
    await new LocalAudit().record(
      tx,
      ctx,
      "redemption.reconcile.requested",
      "point_redemptions",
      id,
      { version: r.version },
    );
    return {
      id,
      scheduled: true,
      message: "已安排服务端核对，未知结果不会强制退款",
    };
  }
}
