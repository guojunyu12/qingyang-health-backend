import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  encrypt,
  decrypt,
  digest,
  validCode,
} from "../src/modules/identity/crypto.js";
test("normalizes ASCII email without merging aliases", () => {
  assert.equal(
    normalizeEmail(" Ab.C+Tag@EXAMPLE.com "),
    "ab.c+tag@example.com",
  );
  assert.throws(() => normalizeEmail("a@"));
  assert.throws(() => normalizeEmail("中@example.com"));
});
test("authenticated encryption and keyed challenge hash", () => {
  const a = encrypt("a@example.com");
  assert.equal(decrypt(a), "a@example.com");
  assert.notEqual(a, encrypt("a@example.com"));
  assert.notEqual(digest("challenge1:123456"), digest("challenge2:123456"));
  assert.ok(validCode("123456"));
  assert.ok(!validCode("12345"));
});
