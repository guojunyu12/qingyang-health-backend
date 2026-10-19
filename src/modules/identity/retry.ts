import type { PoolConnection } from "mysql2/promise";
import { digest, encrypt, decrypt } from "./crypto.js";
import { rows } from "../../common/database.js";
import { isUuid } from "../../common/foundation.js";
import { reject } from "../../common/error.js";
export async function authRetry(
  c: PoolConnection,
  row: any,
  key: string | undefined,
  body: string,
) {
  if (!key) return null;
  if (!isUuid(key)) reject(422, "INVALID_IDEMPOTENCY_KEY", "请求标识无效");
  if (row.retry_key_hash !== digest(key)) return null;
  if (row.retry_body_hash !== digest(body))
    reject(409, "IDEMPOTENCY_CONFLICT", "同一认证请求内容已变化");
  if (
    !row.retry_expires_at ||
    new Date(row.retry_expires_at.replace(" ", "T") + "Z").getTime() <
      Date.now()
  )
    return null;
  const result = JSON.parse(decrypt(row.retry_ciphertext));
  const valid = await rows(
    c,
    "SELECT s.id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.access_token_hash=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND s.access_expires_at>UTC_TIMESTAMP(3) AND u.status='active'",
    [digest(result.access)],
  );
  return valid.length ? result : null;
}
export async function saveAuthRetry(
  c: PoolConnection,
  table: "auth_challenges" | "refresh_tokens",
  id: string,
  key: string | undefined,
  body: string,
  result: unknown,
) {
  if (!key) return;
  if (!isUuid(key)) reject(422, "INVALID_IDEMPOTENCY_KEY", "请求标识无效");
  await c.execute(
    `UPDATE ${table} SET retry_key_hash=?,retry_body_hash=?,retry_ciphertext=?,retry_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND) WHERE id=?`,
    [digest(key), digest(body), encrypt(JSON.stringify(result)), id],
  );
}
