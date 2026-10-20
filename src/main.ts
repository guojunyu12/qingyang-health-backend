import { healthResources } from "./modules/health/integration.js";
import { nutritionResources } from "./modules/nutrition/integration.js";
import "reflect-metadata";
import { modulePorts } from "./common/ports.js";
import { clientIp } from "./common/client-ip.js";
import { resources } from "./resources.js";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { env, origin, production } from "./common/config.js";
import { ApiFailure, reject } from "./common/error.js";
import { IdentityService } from "./modules/identity/service.js";
import { equal } from "./modules/identity/crypto.js";
import { pool } from "./common/database.js";
@Module({})
class AppModule {}
export async function createApp(service = new IdentityService()) {
  if (production) {
    if (!origin.startsWith("https://"))
      throw Error("Production APP_ORIGIN must use HTTPS");
    if (!modulePorts.points)
      throw Error(
        "M05 PointsPort must be registered before production startup",
      );
    if (!process.env.TRUSTED_PROXY_TOKEN)
      throw Error("Production trusted proxy must be configured");
  }
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.use(cookieParser());
  const express = app.getHttpAdapter().getInstance();
  const { default: bodyParser } = await import("express");
  // Thirty named food items can exceed the small public/auth payload budget.
  // Scope the larger limit to M03; keep M01/M02 limits unchanged.
  app.use('/api/v1/me/meals', bodyParser.json({limit:'32kb'}));
  app.use(bodyParser.json({ limit: "8kb" }));
  express.use("/api/v1", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const requestId = randomUUID();
    const meta = () => ({
      requestId,
      serverTime: new Date().toISOString(),
      timezone: "Asia/Shanghai",
    });
    const cookies = {
      httpOnly: true,
      secure: production,
      sameSite: "lax" as const,
      path: "/api/v1",
    };
    const clear = () => {
      res.clearCookie("qy_access", cookies);
      res.clearCookie("qy_refresh", cookies);
    };
    const set = (auth: {
      access: string;
      refresh: string;
      sessionExpiresAt: string;
    }) => {
      res.cookie("qy_access", auth.access, { ...cookies, maxAge: 900000 });
      res.cookie("qy_refresh", auth.refresh, {
        ...cookies,
        expires: new Date(auth.sessionExpiresAt),
      });
    };
    const body = (keys: string[]) => {
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).some((k) => !keys.includes(k))
      )
        reject(422, "INVALID_INPUT", "请求参数不正确");
    };
    const string = (key: string) => {
      if (typeof req.body[key] !== "string")
        reject(422, "INVALID_INPUT", "请求参数不正确");
      return req.body[key] as string;
    };
    try {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin !== origin
      )
        reject(403, "INVALID_ORIGIN", "请求来源无效");
      const key = req.method + " " + req.path;
      let data: unknown;
      switch (key) {
        case "POST /auth/email-codes":
          body(["email", "purpose"]);
          if (req.body.purpose !== "login")
            reject(422, "INVALID_INPUT", "请求用途无效");
          data = await service.send(string("email"), clientIp(req));
          break;
        case "POST /auth/login": {
          body(["challengeId", "code", "deviceId", "platform"]);
          if (req.body.platform !== "h5")
            reject(422, "INVALID_PLATFORM", "当前仅支持H5登录");
          const auth = await service.login(
            string("challengeId"),
            string("code"),
            string("deviceId"),
            String(req.headers["idempotency-key"] ?? ""),
          );
          set(auth);
          data = { user: auth.user, sessionExpiresAt: auth.sessionExpiresAt };
          break;
        }
        case "POST /auth/refresh": {
          body([]);
          const session = await service.refreshSession(
            req.cookies.qy_refresh ?? "",
            true,
          );
          if (
            !equal(
              String(req.headers["x-csrf-token"] ?? ""),
              service.csrf(session.session_id),
            )
          )
            reject(403, "INVALID_CSRF", "安全校验失败");
          const auth = await service.refresh(
            req.cookies.qy_refresh ?? "",
            String(req.headers["idempotency-key"] ?? ""),
          );
          set(auth);
          data = { sessionExpiresAt: auth.sessionExpiresAt };
          break;
        }
        case "GET /me":
          data = await service.me(req.cookies.qy_access ?? "");
          break;
        case "GET /auth/csrf": {
          let s;
          try {
            s = await service.session(req.cookies.qy_access ?? "");
          } catch {
            s = await service.refreshSession(
              req.cookies.qy_refresh ?? "",
              true,
            );
          }
          data = { csrfToken: service.csrf(s.session_id) };
          break;
        }
        case "POST /auth/logout": {
          body([]);
          const s = await service.session(req.cookies.qy_access ?? "");
          if (
            !equal(
              String(req.headers["x-csrf-token"] ?? ""),
              service.csrf(s.session_id),
            )
          )
            reject(403, "INVALID_CSRF", "安全校验失败，请刷新后重试");
          await service.logout(req.cookies.qy_access);
          clear();
          res.status(204).end();
          return;
        }
        case "GET /meta/contract": {
          const [versions] = await pool.query<any[]>(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
          );
          data = {
            contractVersion: "QY-MYSQL-1.1.0",
            schemaVersion: versions[0]?.version ?? null,
            baselineSha256:
              "64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56",
            timezone: "Asia/Shanghai",
          };
          break;
        }
        default: {
          const extra = (await healthResources(req, res, service)) ?? (await nutritionResources(req, res, service)) ?? (await resources(req, res, service));
          if (!extra) reject(404, "NOT_FOUND", "接口不存在");
          if (extra.raw) return;
          if (extra.status === 204) {
            res.status(204).end();
            return;
          }
          res.status(extra.status).json({ data: extra.data, meta: meta() });
          return;
        }
      }
      res.status(200).json({ data, meta: meta() });
    } catch (error) {
      const e =
        error instanceof ApiFailure
          ? error
          : new ApiFailure(500, "INTERNAL_ERROR", "服务暂不可用，请稍后重试");
      if (!(error instanceof ApiFailure))
        console.error(
          "Request failed",
          requestId,
          (error as { code?: string }).code ?? "INTERNAL_ERROR",
        );
      if (e.status === 401 && req.path === "/auth/refresh") clear();
      if (e.retryAfterSeconds)
        res.setHeader("Retry-After", e.retryAfterSeconds);
      res.status(e.status).json({
        error: {
          code: e.code,
          message: e.message,
          ...(e.retryAfterSeconds
            ? { retryAfterSeconds: e.retryAfterSeconds }
            : {}),
        },
        meta: meta(),
      });
    }
  });
  await app.init();
  return app;
}
if (!process.env.AUTH_NO_LISTEN) {
  const app = await createApp();
  await app.listen(Number(env("PORT", "3002")), "127.0.0.1");
  console.log("M01 API listening on 127.0.0.1:" + env("PORT", "3002"));
}
