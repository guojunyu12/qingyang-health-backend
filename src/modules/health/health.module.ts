import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Req,
  Res,
  Module,
} from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  HealthHttpAdapter,
  type HealthCommandExecutor,
  type HealthHttpRequest,
} from "./http.js";
import { HealthService, type HealthDependencies } from "./service.js";

export const HEALTH_QUERY_PORT = "M02.HealthQueryPort";

type IdentityRequest = Request & {
  identity?: HealthHttpRequest["identity"];
  requestId?: string;
};
/** Mount once. M01 middleware sets req.identity and guards CSRF; never read userId from body. */
export function createHealthModule(
  deps: HealthDependencies,
  commands: HealthCommandExecutor,
  integration: "real" | "test" = "test",
  routePrefix = "api/v1",
): DynamicModule {
  if (process.env.NODE_ENV === "production" && integration !== "real")
    throw new Error(
      "M02 production requires real M01 and cross-module adapters",
    );
  const service = new HealthService(deps),
    http = new HealthHttpAdapter(service, commands);
  class HealthController {
    async handle(req: IdentityRequest, res: Response) {
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v[0] : v,
        ]),
      );
      const reply = await http.handle({
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query,
        params: req.params as Record<string, string>,
        headers,
        identity: req.identity,
        requestId: req.requestId ?? randomUUID(),
      });
      res.status(reply.status);
      if (reply.status === 204) res.end();
      else res.json(reply.body);
    }
  }
  Controller()(HealthController);
  // One handler per route avoids requiring reflection metadata or a second dependency container.
  for (const [method, path] of [
    ["GET", "dashboard"],
    ["GET", "health/overview"],
    ["GET", "health-profile"],
    ["PUT", "health-profile"],
    ["GET", "water-records"],
    ["POST", "water-records"],
    ["DELETE", "water-records/:id"],
    ["GET", "weight-records"],
    ["POST", "weight-records"],
    ["DELETE", "weight-records/:id"],
  ] as const) {
    const key = `${method}_${path}`;
    Object.defineProperty(HealthController.prototype, key, {
      value: function (
        this: HealthController,
        req: IdentityRequest,
        res: Response,
      ) {
        return this.handle(req, res);
      },
      writable: true,
      configurable: true,
    });
    const routeDescriptor = Object.getOwnPropertyDescriptor(
      HealthController.prototype,
      key,
    )!;
    Req()(HealthController.prototype, key, 0);
    Res()(HealthController.prototype, key, 1);
    ({ GET: Get, PUT: Put, POST: Post, DELETE: Delete })[method](
      `${routePrefix ? routePrefix + "/" : ""}me/${path}`,
    )(HealthController.prototype, key, routeDescriptor);
  }
  class HealthModule {}
  Module({
    controllers: [HealthController],
    providers: [
      { provide: HealthService, useValue: service },
      { provide: HEALTH_QUERY_PORT, useValue: service.repository },
    ],
    exports: [HealthService, HEALTH_QUERY_PORT],
  })(HealthModule);
  return { module: HealthModule };
}
export { HealthService } from "./service.js";
export { HealthRepository } from "./repository.js";
export type { HealthDependencies } from "./service.js";
export type { HealthCommandExecutor, HealthHttpRequest } from "./http.js";
