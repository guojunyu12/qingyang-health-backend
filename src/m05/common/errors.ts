import { ApiFailure } from "../../common/error.js";
export class DomainError extends ApiFailure {}
export function requireValue(
  test: unknown,
  status: number,
  code: string,
  message: string,
): asserts test {
  if (!test) throw new DomainError(status, code, message);
}
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function exactBody(body: unknown, keys: string[]) {
  requireValue(
    body && typeof body === "object" && !Array.isArray(body),
    422,
    "INVALID_INPUT",
    "请求需要 JSON 对象",
  );
  requireValue(
    Object.keys(body).every((k) => keys.includes(k)),
    422,
    "UNKNOWN_FIELD",
    "请求包含未声明字段",
  );
}
