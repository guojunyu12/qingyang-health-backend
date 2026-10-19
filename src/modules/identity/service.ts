import { authRetry, saveAuthRetry } from "./retry.js";
import { randomInt, randomUUID } from "node:crypto";
import { pool, transaction, rows } from "../../common/database.js";
import { reject } from "../../common/error.js";
import {
  normalizeEmail,
  encrypt,
  decrypt,
  digest,
  token,
  equal,
  validCode,
} from "./crypto.js";
import { limit } from "./limiter.js";
import { MediaService } from "../uploads/service.js";
import { modulePorts, sqlTx } from "../../common/ports.js";
import { sendMail } from "./mailer.js";
export type Account = {
  id: string;
  nickname: string;
  email: string;
  joinedAt: string;
  timezone: string;
};
const dt = (date: Date) => date.toISOString().slice(0, 23).replace("T", " ");
const future = (n: number) => new Date(Date.now() + n * 1000);
const instant = (s: string) => s.replace(" ", "T") + "Z";
const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    s,
  );
const account = (u: any): Account => {
  const email = decrypt(u.email_ciphertext);
  const [local, domain] = email.split("@");
  return {
    id: u.id,
    nickname: u.nickname,
    email: local.slice(0, 1) + "***@" + domain,
    joinedAt: instant(u.created_at),
    timezone: u.timezone,
  };
};
export class IdentityService {
  constructor(
    private readonly mail: (
      email: string,
      code: string,
    ) => Promise<void> = sendMail,
  ) {}
  async send(raw: string, ip: string) {
    let email: string;
    try {
      email = normalizeEmail(raw);
    } catch {
      reject(422, "INVALID_EMAIL", "请输入有效的邮箱地址");
    }
    await limit(email!, ip);
    const id = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const hash = digest(email!);
    await transaction(async (c) => {
      await c.execute(
        "UPDATE auth_challenges SET consumed_at=UTC_TIMESTAMP(3) WHERE email_lookup_hash=? AND consumed_at IS NULL",
        [hash],
      );
      await c.execute(
        "INSERT INTO auth_challenges(id,email_lookup_hash,email_ciphertext,code_hash,expires_at,purpose)VALUES(?,?,?,?,?,'login')",
        [id, hash, encrypt(email!), digest(id + ":" + code), dt(future(300))],
      );
    });
    try {
      await this.mail(email!, code);
      await pool.execute(
        "UPDATE auth_challenges SET delivery_status='sent' WHERE id=? AND delivery_status='pending'",
        [id],
      );
    } catch {
      await pool.execute(
        "UPDATE auth_challenges SET delivery_status='failed',consumed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [id],
      );
      reject(503, "EMAIL_DELIVERY_FAILED", "验证码发送失败，请稍后重试");
    }
    return { challengeId: id, expiresInSeconds: 300, resendAfterSeconds: 60 };
  }
  async login(id: string, code: string, deviceId: string, retryKey?: string) {
    if (!uuid(id) || !uuid(deviceId) || !validCode(code))
      reject(422, "INVALID_INPUT", "请输入6位验证码");
    const result = await transaction(async (c) => {
      const challenge = (
        await rows(c, "SELECT * FROM auth_challenges WHERE id=? FOR UPDATE", [
          id,
        ])
      )[0];
      if (challenge) {
        const cached = await authRetry(
          c,
          challenge,
          retryKey,
          id + ":" + deviceId + ":" + code,
        );
        if (cached) return cached;
      }
      if (
        !challenge ||
        challenge.delivery_status !== "sent" ||
        challenge.consumed_at ||
        challenge.attempts >= 5 ||
        new Date(instant(challenge.expires_at)).getTime() <= Date.now()
      )
        return { error: true } as const;
      if (!equal(challenge.code_hash, digest(id + ":" + code))) {
        await c.execute(
          "UPDATE auth_challenges SET attempts=attempts+1 WHERE id=?",
          [id],
        );
        return { error: true } as const;
      }
      await c.execute(
        "UPDATE auth_challenges SET consumed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [id],
      );
      let user = (
        await rows(c, "SELECT * FROM users WHERE email_lookup_hash=?", [
          challenge.email_lookup_hash,
        ])
      )[0];
      if (!user) {
        const uid = randomUUID();
        await c.execute(
          "INSERT INTO users(id,email_ciphertext,email_lookup_hash,nickname)VALUES(?,?,?,'轻养用户') ON DUPLICATE KEY UPDATE id=id",
          [uid, challenge.email_ciphertext, challenge.email_lookup_hash],
        );
        user = (
          await rows(c, "SELECT * FROM users WHERE email_lookup_hash=?", [
            challenge.email_lookup_hash,
          ])
        )[0];
      }
      if (user.status !== "active") return { disabled: true } as const;
      if (modulePorts.points)
        await modulePorts.points.ensureAccountInTransaction(sqlTx(c), {
          userId: user.id,
        });
      await c.execute(
        "INSERT INTO user_roles(id,user_id,role)VALUES(?,?,'user') ON DUPLICATE KEY UPDATE id=id",
        [randomUUID(), user.id],
      );
      const sid = randomUUID();
      const family = randomUUID();
      const access = token();
      const refresh = token();
      const expiry = dt(future(7 * 86400));
      await c.execute(
        "INSERT INTO user_sessions(id,user_id,device_id,platform,refresh_family_id,expires_at,access_token_hash,access_expires_at)VALUES(?,?,?,'h5',?,?,?,?)",
        [
          sid,
          user.id,
          deviceId,
          family,
          expiry,
          digest(access),
          dt(future(900)),
        ],
      );
      await c.execute(
        "INSERT INTO refresh_tokens(id,session_id,token_hash,expires_at)VALUES(?,?,?,?)",
        [randomUUID(), sid, digest(refresh), expiry],
      );
      const success = {
        user: account(user),
        access,
        refresh,
        sessionExpiresAt: instant(expiry),
      };
      await saveAuthRetry(
        c,
        "auth_challenges",
        id,
        retryKey,
        id + ":" + deviceId + ":" + code,
        success,
      );
      return success;
    });
    if ("error" in result)
      reject(401, "INVALID_CODE", "验证码无效、已过期或尝试次数过多");
    if ("disabled" in result) reject(403, "ACCOUNT_DISABLED", "账号不可用");
    return result;
  }
  async session(access: string) {
    if (!access) reject(401, "UNAUTHENTICATED", "请先登录");
    const [records] = await pool.execute<any[]>(
      "SELECT s.id AS session_id,u.* FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.access_token_hash=? AND s.revoked_at IS NULL AND s.access_expires_at>UTC_TIMESTAMP(3) AND s.expires_at>UTC_TIMESTAMP(3) AND u.status='active'",
      [digest(access)],
    );
    if (!records.length)
      reject(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
    return records[0];
  }
  async me(access: string) {
    const u = await this.session(access);
    let avatarUrl: string | null = null;
    let avatarUrlExpiresAt: string | null = null;
    if (u.avatar_asset_id) {
      const signed = await transaction((c) =>
        new MediaService().readUrl(c, u.id, u.avatar_asset_id),
      );
      avatarUrl = signed?.readUrl ?? null;
      avatarUrlExpiresAt = signed?.readUrlExpiresAt ?? null;
    }
    return { ...account(u), avatarUrl, avatarUrlExpiresAt };
  }
  async refreshSession(refresh: string, allowConsumed = false) {
    if (!refresh) reject(401, "UNAUTHENTICATED", "请重新登录");
    const [records] = await pool.execute<any[]>(
      "SELECT s.id AS session_id FROM refresh_tokens t JOIN user_sessions s ON s.id=t.session_id JOIN users u ON u.id=s.user_id WHERE t.token_hash=? AND (?=1 OR t.consumed_at IS NULL) AND t.expires_at>UTC_TIMESTAMP(3) AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND u.status='active'",
      [digest(refresh), allowConsumed ? 1 : 0],
    );
    if (!records.length) reject(401, "UNAUTHENTICATED", "请重新登录");
    return records[0];
  }
  csrf(sessionId: string) {
    return digest("csrf:" + sessionId);
  }
  async refresh(refresh: string, retryKey?: string) {
    if (!refresh) reject(401, "UNAUTHENTICATED", "请重新登录");
    const result = await transaction(async (c) => {
      const initial = (
        await rows(
          c,
          "SELECT session_id FROM refresh_tokens WHERE token_hash=?",
          [digest(refresh)],
        )
      )[0];
      if (!initial) return null;
      const s = (
        await rows(c, "SELECT * FROM user_sessions WHERE id=? FOR UPDATE", [
          initial.session_id,
        ])
      )[0];
      const old = (
        await rows(
          c,
          "SELECT * FROM refresh_tokens WHERE token_hash=? FOR UPDATE",
          [digest(refresh)],
        )
      )[0];
      if (
        !s ||
        s.revoked_at ||
        new Date(instant(s.expires_at)).getTime() <= Date.now()
      )
        return null;
      const cached = await authRetry(c, old, retryKey, digest(refresh));
      if (cached) return cached;
      if (old.consumed_at) {
        await c.execute(
          "UPDATE user_sessions SET revoked_at=UTC_TIMESTAMP(3),access_token_hash=NULL WHERE id=?",
          [s.id],
        );
        return null;
      }
      if (new Date(instant(old.expires_at)).getTime() <= Date.now())
        return null;
      const user = (
        await rows(c, "SELECT * FROM users WHERE id=?", [s.user_id])
      )[0];
      if (user.status !== "active") return null;
      const access = token(),
        next = token(),
        nid = randomUUID();
      await c.execute(
        "INSERT INTO refresh_tokens(id,session_id,token_hash,expires_at)VALUES(?,?,?,?)",
        [nid, s.id, digest(next), s.expires_at],
      );
      await c.execute(
        "UPDATE refresh_tokens SET consumed_at=UTC_TIMESTAMP(3),replaced_by=? WHERE id=?",
        [nid, old.id],
      );
      await c.execute(
        "UPDATE user_sessions SET access_token_hash=?,access_expires_at=?,last_seen_at=UTC_TIMESTAMP(3) WHERE id=?",
        [digest(access), dt(future(900)), s.id],
      );
      const success = {
        access,
        refresh: next,
        sessionExpiresAt: instant(s.expires_at),
      };
      await saveAuthRetry(
        c,
        "refresh_tokens",
        old.id,
        retryKey,
        digest(refresh),
        success,
      );
      return success;
    });
    if (!result) reject(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
    return result;
  }
  async logout(access: string) {
    const s = await this.session(access);
    await pool.execute(
      "UPDATE user_sessions SET revoked_at=UTC_TIMESTAMP(3),access_token_hash=NULL WHERE id=?",
      [s.session_id],
    );
  }
}
