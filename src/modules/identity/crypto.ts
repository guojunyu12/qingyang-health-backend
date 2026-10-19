import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../../common/config.js";
export function normalizeEmail(value: string) {
  const s = value.trim().toLowerCase();
  if (
    s.length > 254 ||
    !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      s,
    ) ||
    s.split("@")[0].length > 64
  )
    throw new Error("INVALID_EMAIL");
  return s;
}
export function digest(s: string) {
  return createHmac("sha256", env("AUTH_HMAC_KEY")).update(s).digest("hex");
}
export function encrypt(s: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(env("AUTH_ENCRYPTION_KEY"), "hex"),
    iv,
  );
  const ciphertext = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}
export function decrypt(s: string) {
  const [v, iv, tag, data] = s.split(":");
  if (v !== "v1") throw new Error("Unsupported encryption version");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(env("AUTH_ENCRYPTION_KEY"), "hex"),
    Buffer.from(iv, "hex"),
  );
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
export const token = () => randomBytes(32).toString("base64url");
export const validCode = (s: string) => /^\d{6}$/.test(s);
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
