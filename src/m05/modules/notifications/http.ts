import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Req,
  Res,
  Param,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type {
  SqlTx,
  CommandContext,
} from "../../../../contracts/shared_types.js";
import { Config } from "../../common/config.js";
import { MysqlUnitOfWork } from "../../common/database.js";
import { Idempotency } from "../../common/idempotency.js";
import { IdentityPort, safeEqual } from "../../common/identity.js";
import { exactBody, requireValue } from "../../common/errors.js";
import { LocalAudit } from "../../common/ports.js";
import { queryKeys, uuid, asInstant, textValue } from "../activities/model.js";
import { MessagesService, campaign, recipients } from "./service.js";
import { NotificationsWorker, notificationEvents } from "./worker.js";
export function messageControllers(
  config: Config,
  identity: IdentityPort,
  dev: null,
  uow: MysqlUnitOfWork,
  commands: Idempotency,
  service: MessagesService,
  worker: NotificationsWorker,
  failures: null,
  send: (res: Response, data: unknown, status?: number) => unknown,
) {
  async function auth(req: Request, admin = false, write = false) {
    const i = await identity.resolve(req);
    if (admin)
      requireValue(
        i.roles.includes("admin"),
        403,
        "ADMIN_REQUIRED",
        "需要管理员权限",
      );
    if (write) {
      requireValue(
        req.headers.origin === config.origin,
        403,
        "ORIGIN_FORBIDDEN",
        "写入来源不匹配",
      );
      requireValue(
        safeEqual(String(req.headers["x-csrf-token"] || ""), i.csrfToken),
        403,
        "CSRF_INVALID",
        "CSRF 校验未通过",
      );
    }
    return i;
  }
  async function write(
    req: Request,
    res: Response,
    admin: boolean,
    fn: (tx: SqlTx, ctx: CommandContext) => Promise<unknown>,
    status = 200,
    refs: string[] = [],
  ) {
    const i = await auth(req, admin, true);
    queryKeys(req.query, []);
    const r = await commands.run(
      i.id,
      req.method,
      req.path,
      String(req.headers["idempotency-key"] || ""),
      req.body ?? {},
      async (tx, ctx) => {
        if (admin) await service.admin(tx, ctx.userId);
        return { status, body: await fn(tx, ctx) };
      },
      refs,
    );
    return send(res, r.body, r.status);
  }
  @Controller("api/v1")
  class H5 {
    @Get("me/notifications") async list(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const i = await auth(req);
      return send(
        res,
        await uow.readSnapshot((tx) => service.inbox(tx, i.id, req.query)),
      );
    }
    @Put("me/notifications/:id/read") read(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      return write(req, res, false, (tx, ctx) =>
        service.read(tx, ctx, id, req.body ?? {}),
      );
    }
    @Get("notifications/capabilities") caps(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      queryKeys(req.query, ["platform"]);
      requireValue(
        !req.query.platform ||
          ["h5", "ios", "android"].includes(String(req.query.platform)),
        422,
        "INVALID_PLATFORM",
        "平台无效",
      );
      return send(res, {
        inApp: Boolean(service.port),
        webPush: false,
        appPush: false,
        mode: service.port?.mode || "unavailable",
      });
    }
  }
  @Controller("api/v1/admin")
  class Admin {
    @Get("message-campaigns") async list(
      @Req() r: Request,
      @Res() res: Response,
    ) {
      const i = await auth(r, true);
      return send(
        res,
        await uow.readSnapshot((tx) => service.list(tx, i.id, r.query)),
      );
    }
    @Get("message-recipients") async users(
      @Req() r: Request,
      @Res() res: Response,
    ) {
      const i = await auth(r, true);
      return send(
        res,
        await uow.readSnapshot((tx) => service.users(tx, r.query, i.id)),
      );
    }
    @Post("message-campaigns") async create(
      @Req() r: Request,
      @Res() res: Response,
    ) {
      await auth(r, true, true);
      const ids = recipients(r.body?.recipientUserIds);
      return write(
        r,
        res,
        true,
        (tx, ctx) => service.save(tx, ctx, r.body),
        201,
        ids,
      );
    }
    @Patch("message-campaigns/:id") async edit(
      @Param("id") id: string,
      @Req() r: Request,
      @Res() res: Response,
    ) {
      await auth(r, true, true);
      const c = await uow.readSnapshot((tx) => campaign(tx, id));
      const ids = recipients(r.body?.recipientUserIds ?? c.recipient_ids);
      return write(
        r,
        res,
        true,
        (tx, ctx) => service.save(tx, ctx, r.body, id),
        200,
        ids,
      );
    }
    @Get("message-campaigns/:id") async detail(
      @Param("id") id: string,
      @Req() r: Request,
      @Res() res: Response,
    ) {
      await auth(r, true);
      queryKeys(r.query, []);
      return send(res, await uow.readSnapshot((tx) => service.detail(tx, id)));
    }
    @Get("message-campaigns/:id/recipients") async items(
      @Param("id") id: string,
      @Req() r: Request,
      @Res() res: Response,
    ) {
      const i = await auth(r, true);
      return send(
        res,
        await uow.readSnapshot((tx) =>
          service.recipientList(tx, id, i.id, r.query),
        ),
      );
    }
    @Post("message-campaigns/:id/send") async submit(
      @Param("id") id: string,
      @Req() r: Request,
      @Res() res: Response,
    ) {
      await auth(r, true, true);
      const c = await uow.readSnapshot((tx) => campaign(tx, id));
      return write(
        r,
        res,
        true,
        (tx, ctx) => service.send(tx, ctx, id, r.body),
        202,
        c.recipient_ids,
      );
    }
    @Post("message-campaigns/:id/retry") async retry(
      @Param("id") id: string,
      @Req() r: Request,
      @Res() res: Response,
    ) {
      await auth(r, true, true);
      const c = await uow.readSnapshot((tx) => campaign(tx, id));
      return write(
        r,
        res,
        true,
        (tx, ctx) => service.send(tx, ctx, id, r.body, true),
        202,
        c.recipient_ids,
      );
    }
    @Get("audit-logs") async audit(@Req() r: Request, @Res() res: Response) {
      const i = await auth(r, true);
      queryKeys(r.query, ["resourceType", "actorId", "cursor", "limit"]);
      const types = [
        "activities",
        "activity_slots",
        "activity_bookings",
        "community_reports",
        "point_task_definitions",
        "point_rewards",
        "point_redemptions",
        "m05_message_campaigns",
        "media_assets",
      ];
      if (r.query.resourceType)
        requireValue(
          types.includes(String(r.query.resourceType)),
          422,
          "INVALID_RESOURCE_TYPE",
          "仅可查询 M05 资源",
        );
      if (r.query.actorId) uuid(r.query.actorId);
      return send(
        res,
        await uow.readSnapshot(async (tx) => {
          const pg = service.pages.make(r.query, {
              type: "audit",
              actor: i.id,
              resource: r.query.resourceType || null,
              actorId: r.query.actorId || null,
            }),
            cur = pg.where("occurred_at"),
            where = [
              "resource_type IN (" + types.map(() => "?").join(",") + ")",
            ],
            values: any[] = [...types];
          if (r.query.resourceType) {
            where.push("resource_type=?");
            values.push(r.query.resourceType);
          }
          if (r.query.actorId) {
            where.push("actor_user_id=?");
            values.push(r.query.actorId);
          }
          const rows = await tx.query<{
              id: string;
              occurred_at: string;
              actor_user_id: string;
              action: string;
              resource_type: string;
              resource_id: string;
              change_summary: object;
            }>(
              `SELECT id,occurred_at,actor_user_id,action,resource_type,resource_id,change_summary FROM audit_logs WHERE ${where.join(" AND ")}${cur.sql} ORDER BY occurred_at DESC,id DESC LIMIT ${pg.limit + 1}`,
              [...values, ...cur.values],
            ),
            p = pg.page(rows, (e) => e.occurred_at);
          return {
            ...p,
            items: p.items.map((e) => ({
              id: e.id,
              actorId: e.actor_user_id,
              action: e.action,
              resourceType: e.resource_type,
              resourceId: e.resource_id,
              occurredAt: asInstant(e.occurred_at),
              summary: e.change_summary,
            })),
          };
        }),
      );
    }
    @Get("notification-events") async events(
      @Req() r: Request,
      @Res() res: Response,
    ) {
      const i = await auth(r, true);
      queryKeys(r.query, ["cursor", "limit"]);
      return send(
        res,
        await uow.readSnapshot(async (tx) => {
          const pg = service.pages.make(r.query, {
              type: "notification_events",
              actor: i.id,
            }),
            cur = pg.where("created_at"),
            rows = await tx.query<{
              id: string;
              event_type: string;
              status: string;
              attempts: number;
              last_error_code: string | null;
              lease_version: number;
              created_at: string;
            }>(
              `SELECT id,event_type,status,attempts,last_error_code,lease_version,created_at FROM outbox_events WHERE event_type IN (${notificationEvents.map(() => "?").join(",")})${cur.sql} ORDER BY created_at DESC,id DESC LIMIT ${pg.limit + 1}`,
              [...notificationEvents, ...cur.values],
            ),
            p = pg.page(rows, (e) => e.created_at);
          return {
            ...p,
            items: p.items.map((e) => ({
              id: e.id,
              eventType: e.event_type,
              status: e.status,
              attempts: e.attempts,
              errorCode: e.last_error_code,
              version: Number(e.lease_version),
              createdAt: asInstant(e.created_at),
            })),
          };
        }),
      );
    }
    @Post("notification-events/:id/retry") retryEvent(
      @Param("id") id: string,
      @Req() r: Request,
      @Res() res: Response,
    ) {
      return write(
        r,
        res,
        true,
        async (tx, ctx) => {
          exactBody(r.body, ["version"]);
          const [e] = await tx.query<{
            event_type: string;
            lease_version: number;
            status: string;
          }>(
            "SELECT event_type,lease_version,status FROM outbox_events WHERE id=? FOR UPDATE",
            [uuid(id)],
          );
          requireValue(
            e && notificationEvents.includes(e.event_type),
            404,
            "EVENT_NOT_FOUND",
            "通知事件不存在",
          );
          requireValue(
            Number(e.lease_version) === r.body.version &&
              ["pending", "failed"].includes(e.status),
            409,
            "EVENT_STATE_CONFLICT",
            "事件正在处理或状态已变",
          );
          await tx.execute(
            "UPDATE outbox_events SET status='pending',published_at=NULL,next_attempt_at=UTC_TIMESTAMP(3),locked_by=NULL,locked_until=NULL WHERE id=?",
            [id],
          );
          await new LocalAudit().record(
            tx,
            ctx,
            "notification.retry",
            "m05_message_campaigns",
            id,
            { eventType: e.event_type },
          );
          return { scheduled: true };
        },
        202,
      );
    }
  }

  return config.audience === "h5" ? [H5] : [Admin];
}
