import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { createHealthModule } from "../../server/src/modules/health/health.module";
import { HealthError } from "../../server/src/modules/health/errors";
import {
  initializeEmptyDatabase,
  LocalCommands,
  LocalUnitOfWork,
  pool,
} from "./mysql";
import { testPorts } from "./ports";
import type { HealthHttpRequest } from "../../server/src/modules/health/http";

if (
  process.env.NODE_ENV === "production" ||
  process.env.M02_TEST_ADAPTERS !== "1"
)
  throw new Error(
    "仅本地显式 M02_TEST_ADAPTERS=1 可启动联调工具；生产必须接 M01/M05 真实服务",
  );
if (process.argv.includes("--init")) await initializeEmptyDatabase();
const [version] = await pool.query("SELECT VERSION() AS version");
if (!String((version as { version: string }[])[0].version).startsWith("8.4."))
  throw new Error("必须使用 MySQL 8.4");
// Test rule owned by this harness only, never health module; rerunning does not duplicate health records.
await pool.execute(
  "INSERT IGNORE INTO point_task_definitions (id,code,title,description,reward_points,scope,active,rule_version) VALUES ('f0000000-0000-4000-8000-000000000002','daily_water','认真喝水','M02 explicit TEST rule',5,'daily',1,1)",
);
const sessions = new Map<string, { userId: string; csrfToken: string }>();
const allowedOrigin =
  process.env.M02_FRONTEND_ORIGIN ?? "http://127.0.0.1:3001";
function cookie(req: Request) {
  return /(?:^|;\s*)m02_test_session=([^;]+)/.exec(
    req.headers.cookie ?? "",
  )?.[1];
}
const commands = new LocalCommands(new LocalUnitOfWork(), (req) => {
  const session = [...sessions.values()].find(
    (x) =>
      x.userId === req.identity?.userId &&
      x.csrfToken === req.headers["x-csrf-token"],
  );
  if (!session)
    throw new HealthError(
      403,
      "CSRF_INVALID",
      "页面验证已失效，请重新选择测试账号",
    );
});
class AppModule {}
Module({
  imports: [
    createHealthModule(
      { uow: commands.uow, now: () => new Date(), ...testPorts() },
      commands,
    ),
  ],
})(AppModule);
const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
app.enableCors({
  origin: allowedOrigin,
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "X-CSRF-Token",
    "Idempotency-Key",
    "X-Client-Platform",
  ],
});
app.use(
  (
    req: Request & {
      identity?: HealthHttpRequest["identity"];
      requestId?: string;
    },
    res: Response,
    next: NextFunction,
  ) => {
    res.setHeader("Cache-Control", "no-store");
    req.requestId = randomUUID();
    if (
      req.method !== "GET" &&
      req.method !== "OPTIONS" &&
      req.headers.origin !== allowedOrigin
    ) {
      res.status(403).json({
        error: {
          code: "ORIGIN_INVALID",
          message: "仅允许已配置的本地前端来源",
        },
      });
      return;
    }
    const session = sessions.get(cookie(req) ?? "");
    if (req.path === "/dev/session" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024) req.destroy();
      });
      req.on("end", () => {
        try {
          const input = JSON.parse(body);
          if (
            !["a", "b"].includes(input.account) ||
            Object.keys(input).length !== 1
          )
            throw new Error();
          const account = input.account as "a" | "b",
            key = randomUUID();
          if (cookie(req)) sessions.delete(cookie(req)!);
          const created = {
            userId:
              account === "a"
                ? "a0000000-0000-4000-8000-000000000001"
                : "a0000000-0000-4000-8000-000000000002",
            csrfToken: randomUUID(),
          };
          sessions.set(key, created);
          res.cookie("m02_test_session", key, {
            httpOnly: true,
            sameSite: "strict",
            maxAge: 3600000,
            path: "/",
          });
          res.json({
            userId: created.userId,
            csrfToken: created.csrfToken,
            testAdapters: true,
          });
        } catch {
          res.status(422).json({ error: { message: "请选择测试账号 a 或 b" } });
        }
      });
      return;
    }
    if (req.path === "/dev/session" && req.method === "GET") {
      if (session) res.json({ ...session, testAdapters: true });
      else res.status(401).json({ error: { message: "请选择本地测试账号" } });
      return;
    }
    if (session) req.identity = { userId: session.userId };
    next();
  },
);
await app.listen(Number(process.env.M02_API_PORT ?? 4002), "127.0.0.1");
console.log(
  `M02 local integration API: http://127.0.0.1:${process.env.M02_API_PORT ?? 4002} (MySQL 8.4; test auth + cross-module adapters)`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
