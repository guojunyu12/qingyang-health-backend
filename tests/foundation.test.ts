import { test } from "node:test";
import assert from "node:assert/strict";
import { safeAction, canonical } from "../src/common/foundation.js";
test("notification routes reject external and encoded paths", () => {
  assert.equal(safeAction("/training"), "/training");
  for (const p of [
    "//evil.com",
    "/%2f%2fevil.com",
    "https://evil.com",
    "/admin",
    "/training?redirect=evil",
  ])
    assert.throws(() => safeAction(p));
});
test("idempotency hashes stable object key ordering", () => {
  assert.equal(
    canonical({ b: 1, a: { d: 2, c: 3 } }),
    canonical({ a: { c: 3, d: 2 }, b: 1 }),
  );
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});
