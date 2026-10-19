import { isIP } from "node:net";
import type { Request } from "express";
import { equal } from "../modules/identity/crypto.js";
import { production } from "./config.js";
import { reject } from "./error.js";
/** Trusted ingress must overwrite BOTH headers; never trust arbitrary X-Forwarded-For. */
export function clientIp(req: Request) {
  const secret = process.env.TRUSTED_PROXY_TOKEN;
  const peer = req.socket.remoteAddress ?? "unknown";
  if (
    secret &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) &&
    equal(String(req.headers["x-qy-proxy-token"] ?? ""), secret)
  ) {
    const ip = String(req.headers["x-real-ip"] ?? "");
    if (isIP(ip)) return ip;
    reject(403, "INVALID_PROXY_ADDRESS", "代理来源无效");
  }
  if (production) reject(503, "PROXY_NOT_CONFIGURED", "可信代理尚未配置");
  return peer;
}
