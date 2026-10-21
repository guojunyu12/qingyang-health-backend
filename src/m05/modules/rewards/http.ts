import type { MediaPort } from "../../../../contracts/shared_types.js";
import { withMedia } from "../../common/media.js";
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
import { queryKeys, uuid } from "../activities/model.js";
import { redemption } from "./model.js";
import { RewardsService } from "./service.js";
import { RewardsQueries } from "./queries.js";
import { RedemptionWorker } from "./worker.js";
export function rewardsControllers(
  config: Config,
  identity: IdentityPort,
  dev: null,
  uow: MysqlUnitOfWork,
  commands: Idempotency,
  service: RewardsService,
  worker: RedemptionWorker,
  send: (res: Response, data: unknown, status?: number) => unknown,
  media?: MediaPort,
) {
  const queries = new RewardsQueries(config.sessionSecret, service);
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
        "写入请求来源不匹配",
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
  class Public {
    @Get("points/rewards") async list(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      return send(
        res,
        await withMedia(
          await uow.readSnapshot((tx) => queries.rewards(tx, req.query)),
          media,
        ),
      );
    }
    @Get("me/points/redemptions") async orders(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const i = await auth(req);
      return send(
        res,
        await uow.readSnapshot((tx) => queries.orders(tx, i.id, req.query)),
      );
    }
    @Get("me/points/redemptions/:id") async detail(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const i = await auth(req);
      queryKeys(req.query, []);
      return send(
        res,
        await uow.readSnapshot((tx) => queries.detail(tx, id, i.id)),
      );
    }
    @Post("me/points/redemptions") redeem(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      return write(
        req,
        res,
        false,
        (tx, ctx) => service.redeem(tx, ctx, req.body),
        201,
      );
    }
  }
  @Controller("api/v1/admin/points")
  class Admin {
    @Get("rewards") async list(@Req() req: Request, @Res() res: Response) {
      const i = await auth(req, true);
      return send(
        res,
        await withMedia(
          await uow.readSnapshot((tx) => queries.rewards(tx, req.query, i.id)),
          media,
          i.id,
        ),
      );
    }
    @Get("rewards/:id") async detail(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const i = await auth(req, true);
      queryKeys(req.query, []);
      return send(
        res,
        await withMedia(
          await uow.readSnapshot((tx) => queries.reward(tx, id)),
          media,
          i.id,
        ),
      );
    }
    @Post("rewards") create(@Req() req: Request, @Res() res: Response) {
      return write(
        req,
        res,
        true,
        (tx, ctx) => service.save(tx, ctx, req.body),
        201,
      );
    }
    @Patch("rewards/:id") save(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      return write(req, res, true, (tx, ctx) =>
        service.save(tx, ctx, req.body, uuid(id)),
      );
    }
    @Post("rewards/:id/publish") publish(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      return write(req, res, true, (tx, ctx) =>
        service.lifecycle(tx, ctx, uuid(id), req.body),
      );
    }
    @Post("rewards/:id/archive") archive(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      return write(req, res, true, (tx, ctx) =>
        service.lifecycle(tx, ctx, uuid(id), req.body, true),
      );
    }
    @Get("redemptions") async orders(
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const i = await auth(req, true);
      return send(
        res,
        await uow.readSnapshot((tx) =>
          queries.orders(tx, i.id, req.query, true),
        ),
      );
    }
    @Get("redemptions/:id") async order(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const i = await auth(req, true);
      queryKeys(req.query, []);
      return send(
        res,
        await uow.readSnapshot((tx) => queries.detail(tx, id, i.id, true)),
      );
    }
    @Post("redemptions/:id/reconcile") async reconcile(
      @Param("id") id: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      await auth(req, true, true);
      const r = await uow.readSnapshot((tx) => redemption(tx, id));
      return write(
        req,
        res,
        true,
        (tx, ctx) => service.scheduleReconcile(tx, ctx, id, req.body),
        202,
        [r.user_id],
      );
    }
  }

  return config.audience === "h5" ? [Public] : [Admin];
}
