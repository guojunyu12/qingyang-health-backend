import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { Controller, Get, Req, Res, Param } from "@nestjs/common";
import type { Request } from "express";
import { env, origin, production } from "../common/config.js";
import {
  modulePorts,
  mediaPort,
  unitOfWorkPort,
  notificationsPort,
  userAdministrationPort,
} from "../common/ports.js";
import { reject } from "../common/error.js";
import type { IdentityService } from "../modules/identity/service.js";
import type { IdentityPort } from "./common/identity.js";
import type { Config } from "./common/config.js";
import { Database, MysqlUnitOfWork } from "./common/database.js";
import { Idempotency } from "./common/idempotency.js";
import { PointsService } from "./modules/points/points.js";
import { pointsControllers } from "./modules/points/http.js";
import { ActivitiesService } from "./modules/activities/service.js";
import { CommunityService } from "./modules/activities/community.js";
import { activityControllers } from "./modules/activities/http.js";
import { ActivitySettlementWorker } from "./modules/activities/worker.js";
import { RewardsService } from "./modules/rewards/service.js";
import { CodeVault, UnavailableProvider } from "./modules/rewards/provider.js";
import { RedemptionWorker } from "./modules/rewards/worker.js";
import { rewardsControllers } from "./modules/rewards/http.js";
import { MessagesService } from "./modules/notifications/service.js";
import { NotificationsWorker } from "./modules/notifications/worker.js";
import { Paging, queryKeys, uuid } from "./modules/activities/model.js";
import { messageControllers } from "./modules/notifications/http.js";

type MaterialRow = {
  id: string;
  purpose: "activity_cover" | "reward_image";
  status: string;
  content_type: string;
  size_bytes: number;
  error_code: string | null;
  created_at: string;
};
async function materialDto(row: MaterialRow, actorUserId: string) {
  const signed =
    row.status === "ready"
      ? await mediaPort.createReadUrl({
          assetId: row.id,
          purpose: row.purpose,
          actorUserId,
          access: "admin_material",
        })
      : null;
  return {
    assetId: row.id,
    purpose: row.purpose,
    status: row.status,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    readUrl: signed?.readUrl ?? null,
    errorCode: row.error_code,
  };
}
export const m05Database = new Database();
export const m05Uow = new MysqlUnitOfWork(m05Database);
export const m05Points = new PointsService();
export const m05Activities = new ActivitiesService(mediaPort);
export const m05Community = new CommunityService(
  env("AUTH_HMAC_KEY"),
  m05Activities,
  userAdministrationPort,
);
export const m05Rewards = new RewardsService(
  new UnavailableProvider(),
  new CodeVault(process.env.REWARD_CODE_KEY),
  mediaPort,
);
export const m05Messages = new MessagesService(
  env("AUTH_HMAC_KEY"),
  notificationsPort,
);
export const m05NotificationWorker = new NotificationsWorker(
  m05Uow,
  m05Messages,
);
export const m05RedemptionWorker = new RedemptionWorker(m05Uow, m05Rewards);
export const m05SettlementWorker = new ActivitySettlementWorker(
  m05Uow,
  m05Activities,
);
modulePorts.points = m05Points;
modulePorts.pointsQuery = m05Points;
modulePorts.activities = {
  async activeBookingCount(tx, userId, at) {
    const [row] = await tx.query<{ n: number }>(
      "SELECT COUNT(*) n FROM activity_bookings b JOIN activity_slots s ON s.id=b.slot_id WHERE b.user_id=? AND b.status='confirmed' AND s.status='open' AND s.end_at>?",
      [userId, new Date(at)],
    );
    return Number(row.n);
  },
};

export function createM05Controllers(service: IdentityService) {
  const identity: IdentityPort = {
    async resolve(req) {
      const session = await service.session(req.cookies.qy_access ?? "");
      const roles = await m05Database.query<{ role: string }>(
        "SELECT role FROM user_roles WHERE user_id=?",
        [session.id],
      );
      const account = await service.me(req.cookies.qy_access ?? "");
      return {
        id: session.id,
        nickname: account.nickname,
        sessionId: session.session_id,
        roles: roles.map((row) => row.role),
        csrfToken: service.csrf(session.session_id),
      };
    },
  };
  const send = (res: Response, data: unknown, status = 200) =>
    res
      .status(status)
      .json({
        data,
        meta: {
          requestId: randomUUID(),
          serverTime: new Date().toISOString(),
          timezone: "Asia/Shanghai",
        },
      });
  const configuration = (audience: "h5" | "admin"): Config => ({
    audience,
    port: 0,
    origin:
      audience === "admin"
        ? env("ADMIN_ORIGIN", "http://127.0.0.1:3003")
        : origin,
    production,
    devIdentity: false,
    sessionSecret: env("AUTH_HMAC_KEY"),
    devToken: "",
    db: { host: "", port: 0, user: "", password: "", database: env("DB_NAME") },
  });
  const commands = new Idempotency(m05Uow);
  @Controller("api/v1")
  class SessionController {
    @Get("me/m05-session") async session(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const { sessionId: _sessionId, ...user } = await identity.resolve(req);
      return send(res, { ...user, identityMode: "m01_email" });
    }
    @Get("admin/overview") async overview(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const user = await identity.resolve(req);
      if (!user.roles.includes("admin"))
        reject(403, "ADMIN_REQUIRED", "需要管理员权限");
      return send(
        res,
        await unitOfWorkPort.readSnapshot(async (tx) => {
          const [row] = await tx.query<Record<string, number>>(
            "SELECT (SELECT COALESCE(SUM(balance),0) FROM point_accounts) totalAvailablePoints,(SELECT COUNT(*) FROM activities WHERE status='published') publishedActivities,(SELECT COUNT(*) FROM activity_bookings WHERE status='confirmed') confirmedBookings,(SELECT COUNT(*) FROM point_rewards WHERE status='published') publishedRewards,(SELECT COUNT(*) FROM point_redemptions WHERE status='pending') pendingRedemptions,(SELECT COUNT(*) FROM community_reports WHERE status='pending') openReports,(SELECT COUNT(*) FROM m05_message_campaigns WHERE status IN ('queued','sending','completed','partial_failed')) sentCampaigns,(SELECT COUNT(*) FROM notifications WHERE read_at IS NULL) unreadNotifications",
            [],
          );
          return Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, Number(value)]),
          );
        }),
      );
    }
    @Get("admin/media-assets") async assets(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const user = await identity.resolve(req);
      if (!user.roles.includes("admin"))
        reject(403, "ADMIN_REQUIRED", "需要管理员权限");
      queryKeys(req.query, ["purpose", "status", "cursor", "limit"]);
      if (
        req.query.purpose &&
        !["activity_cover", "reward_image"].includes(String(req.query.purpose))
      )
        reject(422, "INVALID_PURPOSE", "仅支持活动或权益素材");
      if (
        req.query.status &&
        !["pending", "validating", "ready", "rejected"].includes(
          String(req.query.status),
        )
      )
        reject(422, "INVALID_STATUS", "素材状态无效");
      const page = new Paging(env("AUTH_HMAC_KEY")).make(req.query, {
        type: "admin_materials",
        actor: user.id,
        purpose: req.query.purpose ?? null,
        status: req.query.status ?? null,
      });
      const cursor = page.where("created_at");
      const result = await unitOfWorkPort.readSnapshot(async (tx) => {
        const conditions = [
          "purpose IN ('activity_cover','reward_image')",
          "status<>'deleted'",
        ];
        const values: string[] = [];
        if (req.query.purpose) {
          conditions.push("purpose=?");
          values.push(String(req.query.purpose));
        }
        if (req.query.status) {
          conditions.push("status=?");
          values.push(String(req.query.status));
        }
        const rows = await tx.query<MaterialRow>(
          `SELECT id,purpose,status,COALESCE(safe_content_type,content_type) content_type,COALESCE(safe_size_bytes,size_bytes) size_bytes,error_code,created_at FROM media_assets WHERE ${conditions.join(" AND ")}${cursor.sql} ORDER BY created_at DESC,id DESC LIMIT ${page.limit + 1}`,
          [...values, ...cursor.values],
        );
        return page.page(rows, (row) => row.created_at);
      });
      return send(res, {
        ...result,
        items: await Promise.all(
          result.items.map((row) => materialDto(row, user.id)),
        ),
      });
    }
    @Get("admin/media-assets/:id") async asset(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const user = await identity.resolve(req);
      if (!user.roles.includes("admin"))
        reject(403, "ADMIN_REQUIRED", "需要管理员权限");
      const [row] = await m05Database.query<MaterialRow>(
        "SELECT id,purpose,status,COALESCE(safe_content_type,content_type) content_type,COALESCE(safe_size_bytes,size_bytes) size_bytes,error_code,created_at FROM media_assets WHERE id=? AND purpose IN ('activity_cover','reward_image') AND status<>'deleted'",
        [uuid(id)],
      );
      if (!row) reject(404, "NOT_FOUND", "素材不存在");
      return send(res, await materialDto(row, user.id));
    }
    @Get("admin/runtime") async runtime(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const user = await identity.resolve(req);
      if (!user.roles.includes("admin"))
        reject(403, "ADMIN_REQUIRED", "需要管理员权限");
      const versions = await m05Database.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      return send(res, {
        contractVersion: "QY-MYSQL-1.1.0",
        schemaVersion: versions.at(-1)?.version,
        identityAdapter: "m01_email",
        timezone: "Asia/Shanghai",
        provider: "unavailable",
        webPush: false,
      });
    }
  }
  return [
    SessionController,
    ...(["h5", "admin"] as const).flatMap((audience) => {
      const config = configuration(audience);
      return [
        ...pointsControllers(config, identity, null, m05Uow, commands, send),
        ...activityControllers(
          config,
          identity,
          null,
          m05Uow,
          commands,
          m05Activities,
          m05Community,
          send,
          mediaPort,
        ),
        ...rewardsControllers(
          config,
          identity,
          null,
          m05Uow,
          commands,
          m05Rewards,
          m05RedemptionWorker,
          send,
          mediaPort,
        ),
        // Keep the existing M01 inbox/read/capability endpoints unchanged.
        ...(audience === "admin"
          ? messageControllers(
              config,
              identity,
              null,
              m05Uow,
              commands,
              m05Messages,
              m05NotificationWorker,
              null,
              send,
            )
          : []),
      ];
    }),
  ];
}
export function isM05Path(path: string) {
  return /^\/(?:admin(?:\/|$)|activities(?:\/|$)|activity-slots(?:\/|$)|community(?:\/|$)|points\/rewards(?:\/|$)|me\/(?:m05-session|points(?:\/|$)|bookings(?:\/|$)|community-profile|blocks(?:\/|$)))/.test(
    path,
  );
}

/** Consumers never claim Outbox themselves; the M01 dispatcher supplies the lease. */
export async function installM05Consumers() {
  const { registerDirectOutboxConsumer } = await import("../common/outbox.js");
  const { notificationEvents } =
    await import("./modules/notifications/worker.js");
  const unregister = notificationEvents.map((type) =>
    registerDirectOutboxConsumer(type, (lease) =>
      m05NotificationWorker.consume(lease),
    ),
  );
  unregister.push(
    registerDirectOutboxConsumer("points.redemption.requested.v1", (lease) =>
      m05RedemptionWorker.execute(lease),
    ),
  );
  return () => unregister.forEach((remove) => remove());
}
export async function processM05Recipients() {
  let count = 0;
  for (; count < 100; count++) {
    const lease = await m05NotificationWorker.claimRecipient();
    if (!lease) break;
    await m05NotificationWorker.recipient(lease);
  }
  return count;
}
