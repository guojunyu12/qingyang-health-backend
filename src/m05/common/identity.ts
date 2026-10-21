import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { DomainError } from "./errors.js";
export interface Identity {
  id: string;
  nickname: string;
  roles: string[];
  sessionId: string;
  csrfToken: string;
}
export interface IdentityPort {
  resolve(req: Request): Promise<Identity>;
}
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export class UnconfiguredM01Identity implements IdentityPort {
  async resolve(_req: Request): Promise<Identity> {
    throw new DomainError(
      503,
      "IDENTITY_NOT_CONFIGURED",
      "请接入 M01 身份服务",
    );
  }
}
