import { createClient } from "redis";
import { env } from "../../common/config.js";
import { digest } from "./crypto.js";
import { reject } from "../../common/error.js";
export const redis = createClient({
  socket: {
    host: env("REDIS_HOST", "127.0.0.1"),
    port: Number(env("REDIS_PORT", "6380")),
    connectTimeout: 3000,
    reconnectStrategy: false,
  },
  password: env("REDIS_PASSWORD"),
});
redis.on("error", () => {});
let opening: Promise<unknown> | null = null;
export async function limit(email: string, ip: string) {
  try {
    if (!redis.isOpen) {
      opening ??= redis.connect().finally(() => {
        opening = null;
      });
      await opening;
    }
    const keys = [
      `auth:${env("DB_NAME")}:email60:${digest(email)}`,
      `auth:${env("DB_NAME")}:emailHour:${digest(email)}`,
      `auth:${env("DB_NAME")}:ipHour:${digest(ip)}`,
    ];
    const result = await redis.eval(
      `local caps={1,5,20}; local ttl={60,3600,3600}; for i,k in ipairs(KEYS) do if tonumber(redis.call('GET',k) or '0')>=caps[i] then return redis.call('TTL',k) end end; for i,k in ipairs(KEYS) do local n=redis.call('INCR',k); if n==1 then redis.call('EXPIRE',k,ttl[i]) end end; return 0`,
      { keys, arguments: [] },
    );
    if (Number(result) !== 0)
      reject(
        429,
        "RATE_LIMITED",
        "操作频繁，请稍后重试",
        Math.max(1, Number(result)),
      );
  } catch (e) {
    if (e instanceof Error && e.name === "Error" && "status" in e) throw e;
    reject(503, "RATE_LIMIT_UNAVAILABLE", "验证码服务暂不可用，请稍后重试");
  }
}
