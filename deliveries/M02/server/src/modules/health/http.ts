import type {
  CommandContext,
  SqlTx,
  UUID,
} from "../../../../contracts/shared_types";
import { HealthError } from "./errors";
import { HealthService } from "./service";

/** M01 supplies authenticated identity, CSRF checks and a leased idempotent transaction. */
export interface HealthHttpRequest {
  method: string;
  path: string;
  body?: unknown;
  query: Record<string, unknown>;
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  identity?: { userId: UUID };
  requestId: UUID;
}
export interface HealthCommandExecutor {
  execute<T>(
    request: HealthHttpRequest,
    status: number,
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ): Promise<T>;
}
export interface HealthHttpReply {
  status: number;
  body?: unknown;
}
export class HealthHttpAdapter {
  constructor(
    readonly service: HealthService,
    readonly commands: HealthCommandExecutor,
  ) {}
  async handle(request: HealthHttpRequest): Promise<HealthHttpReply> {
    const meta = () => ({
      requestId: request.requestId,
      serverTime: this.service.deps.now().toISOString(),
      timezone: "Asia/Shanghai",
    });
    try {
      if (!request.identity)
        throw new HealthError(
          401,
          "UNAUTHENTICATED",
          "请先登录后查看个人健康记录",
        );
      const userId = request.identity.userId,
        path = request.path,
        method = request.method;
      if (
        (path === "/api/v1/me/health-profile" || method !== "GET") &&
        Object.keys(request.query).length
      )
        throw new HealthError(422, "VALIDATION_ERROR", "该接口不接受查询参数");
      let data: unknown,
        status = 200;
      if (path === "/api/v1/me/dashboard" && method === "GET")
        data = await this.service.dashboard(userId, request.query);
      else if (path === "/api/v1/me/health/overview" && method === "GET")
        data = await this.service.overview(userId, request.query);
      else if (path === "/api/v1/me/health-profile" && method === "GET")
        data = await this.service.deps.uow.readSnapshot((tx) =>
          this.service.profile(tx, userId),
        );
      else if (path === "/api/v1/me/health-profile" && method === "PUT")
        data = await this.commands.execute(request, 200, (tx, ctx) =>
          this.service.saveProfile(tx, ctx, request.body),
        );
      else {
        const match =
          /^\/api\/v1\/me\/(water|weight)-records(?:\/([^/]+))?$/.exec(path);
        if (!match) throw new HealthError(404, "NOT_FOUND", "接口不存在");
        const type = match[1] as "water" | "weight",
          id = match[2];
        if (method === "GET" && !id)
          data = await this.service.deps.uow.readSnapshot((tx) =>
            this.service.list(tx, userId, type, request.query),
          );
        else if (method === "POST" && !id) {
          status = 201;
          data = await this.commands.execute<unknown>(
            request,
            status,
            (tx, ctx) =>
              type === "water"
                ? this.service.addWater(tx, ctx, request.body)
                : this.service.addWeight(tx, ctx, request.body),
          );
        } else if (method === "DELETE" && id) {
          await this.commands.execute(request, 204, (tx, ctx) =>
            this.service.remove(tx, ctx, type, id),
          );
          return { status: 204 };
        } else throw new HealthError(404, "NOT_FOUND", "接口不存在");
      }
      return { status, body: { data, meta: meta() } };
    } catch (error) {
      const e = error as {
        status?: number;
        code?: string;
        message?: string;
        field?: string;
        fields?: Record<string, string>;
      };
      const known =
        error instanceof HealthError || e.code === "VALIDATION_ERROR";
      const { timezone: _, ...errorMeta } = meta();
      return {
        status: known ? (e.status ?? 422) : 500,
        body: {
          error: {
            code: known ? e.code : "INTERNAL_ERROR",
            message: known ? e.message : "服务暂时不可用，请稍后重试",
            ...(e.fields || e.field
              ? { fields: e.fields ?? { [e.field!]: e.message! } }
              : {}),
          },
          meta: errorMeta,
        },
      };
    }
  }
}
