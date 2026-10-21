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
import type { SqlTx } from "../../../../contracts/shared_types.js";
import { Config } from "../../common/config.js";
import { Clock, MysqlUnitOfWork } from "../../common/database.js";
import { Idempotency } from "../../common/idempotency.js";
import { IdentityPort, safeEqual } from "../../common/identity.js";
import { exactBody, requireValue } from "../../common/errors.js";
import { LocalAudit } from "../../common/ports.js";
import { PointsService, RuleRow, ruleDto, taskCodes } from "./points.js";
import { PointQueries, dateValue, queryKeys } from "./queries.js";
export function pointsControllers(
  config: Config,
  identity: IdentityPort,
  dev: null,
  uow: MysqlUnitOfWork,
  commands: Idempotency,
  send: (res: Response, data: unknown, status?: number) => unknown,
) {
  const points = new PointsService(),
    queries = new PointQueries(config.sessionSecret),
    clock = uow.clock;
  const adminRole = async (tx: SqlTx, id: string) =>
    requireValue(
      (
        await tx.query(
          "SELECT role FROM user_roles WHERE user_id=? AND role=?",
          [id, "admin"],
        )
      ).length,
      403,
      "ADMIN_REQUIRED",
      "需要管理员权限",
    );
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
  @Controller("api/v1/me/points")
  class H5PointsController {
    @Get("account") async account(@Req() req: Request, @Res() res: Response) {
      const i = await auth(req);
      queryKeys(req.query, []);
      return send(
        res,
        await uow.runForUser(i.id, (tx) =>
          points.ensureAccountInTransaction(tx, { userId: i.id }),
        ),
      );
    }
    @Get("tasks") async tasks(@Req() req: Request, @Res() res: Response) {
      const i = await auth(req);
      queryKeys(req.query, ["date"]);
      const today = clock.businessDate(clock.now()),
        date = req.query.date === undefined ? today : dateValue(req.query.date);
      requireValue(date <= today, 422, "FUTURE_DATE", "不能查询未来任务");
      return send(
        res,
        await uow.readSnapshot(async (tx) => ({
          date,
          serverDate: today,
          historical: date !== today,
          items: await points.tasks(tx, i.id, date),
          consecutiveCheckinDays: await points.consecutiveCheckinDays(
            tx,
            i.id,
            date,
          ),
        })),
      );
    }
    @Get("ledger") async ledger(@Req() req: Request, @Res() res: Response) {
      const i = await auth(req);
      return send(
        res,
        await uow.readSnapshot((tx) => queries.ledger(tx, i.id, req.query)),
      );
    }
    @Post("check-in") async checkin(@Req() req: Request, @Res() res: Response) {
      const i = await auth(req, false, true);
      exactBody(req.body ?? {}, []);
      queryKeys(req.query, []);
      const r = await commands.run(
        i.id,
        "POST",
        "/api/v1/me/points/check-in",
        String(req.headers["idempotency-key"] || ""),
        {},
        async (tx, ctx) => {
          const prior = await tx.query(
            "SELECT id FROM point_task_awards WHERE user_id=? AND task_code=? AND business_date=?",
            [i.id, "daily_checkin", ctx.businessDate],
          );
          return {
            status: 200,
            body: {
              businessDate: ctx.businessDate,
              alreadyCompleted: prior.length > 0,
              ...(await points.awardInTransaction(tx, ctx, {
                type: "checkin",
              })),
            },
          };
        },
      );
      return send(res, r.body, r.status);
    }
  }
  @Controller("api/v1/admin/points")
  class AdminPointsController {
    @Get("accounts") async accounts(@Req() req: Request, @Res() res: Response) {
      const i = await auth(req, true);
      return send(
        res,
        await uow.readSnapshot((tx) => queries.accounts(tx, i.id, req.query)),
      );
    }
    @Get("ledger") async ledger(@Req() req: Request, @Res() res: Response) {
      const i = await auth(req, true);
      return send(
        res,
        await uow.readSnapshot((tx) =>
          queries.ledger(tx, i.id, req.query, true),
        ),
      );
    }
    @Get("tasks") async tasks(@Req() req: Request, @Res() res: Response) {
      await auth(req, true);
      queryKeys(req.query, []);
      return send(res, {
        items: await uow.readSnapshot(async (tx) =>
          (
            await tx.query<RuleRow>(
              "SELECT * FROM point_task_definitions ORDER BY id",
              [],
            )
          )
            .sort(
              (a, b) => taskCodes.indexOf(a.code) - taskCodes.indexOf(b.code),
            )
            .map(ruleDto),
        ),
      });
    }
    @Patch("tasks/:code") async edit(
      @Param("code") code: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const i = await auth(req, true, true);
      queryKeys(req.query, []);
      exactBody(req.body, [
        "expectedRuleVersion",
        "rewardPoints",
        "active",
        "title",
        "description",
      ]);
      const b = req.body;
      requireValue(
        taskCodes.includes(code as (typeof taskCodes)[number]),
        404,
        "TASK_NOT_FOUND",
        "任务不存在",
      );
      requireValue(
        Number.isInteger(b.expectedRuleVersion) &&
          b.expectedRuleVersion >= 1 &&
          Number.isInteger(b.rewardPoints) &&
          b.rewardPoints > 0 &&
          b.rewardPoints <= 2147483647 &&
          typeof b.active === "boolean",
        422,
        "INVALID_RULE",
        "版本、分值或启用状态无效",
      );
      requireValue(
        b.title === undefined ||
          (typeof b.title === "string" &&
            b.title.trim().length > 0 &&
            [...b.title.trim()].length <= 80),
        422,
        "INVALID_TITLE",
        "标题需要 1—80 字",
      );
      requireValue(
        b.description === undefined ||
          (typeof b.description === "string" && b.description.length <= 2000),
        422,
        "INVALID_DESCRIPTION",
        "说明最多 2000 字",
      );
      const r = await commands.run(
        i.id,
        "PATCH",
        `/api/v1/admin/points/tasks/${code}`,
        String(req.headers["idempotency-key"] || ""),
        b,
        async (tx, ctx) => {
          await adminRole(tx, i.id);
          const [old] = await tx.query<RuleRow>(
            "SELECT * FROM point_task_definitions WHERE code=? FOR UPDATE",
            [code],
          );
          requireValue(old, 404, "TASK_NOT_FOUND", "任务不存在");
          requireValue(
            old.rule_version === b.expectedRuleVersion &&
              old.rule_version < 2147483647,
            409,
            "RULE_VERSION_CONFLICT",
            "规则已更新，请刷新后重新编辑",
          );
          await tx.execute(
            "UPDATE point_task_definitions SET title=?,description=?,reward_points=?,active=?,rule_version=rule_version+1 WHERE code=?",
            [
              b.title?.trim() ?? old.title,
              b.description ?? old.description,
              b.rewardPoints,
              b.active,
              code,
            ],
          );
          const [updated] = await tx.query<RuleRow>(
            "SELECT * FROM point_task_definitions WHERE code=?",
            [code],
          );
          await new LocalAudit().record(
            tx,
            ctx,
            "points.rule.updated",
            "point_task_definitions",
            code,
            { before: ruleDto(old), after: ruleDto(updated) },
          );
          return { status: 200, body: ruleDto(updated) };
        },
      );
      return send(res, r.body, r.status);
    }
  }

  return [
    ...(config.audience === "h5"
      ? [H5PointsController]
      : [AdminPointsController]),
  ];
}
