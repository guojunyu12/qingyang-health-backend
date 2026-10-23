import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
const document = JSON.parse(
  readFileSync(new URL("../contracts/openapi/M05.yaml", import.meta.url), "utf8"),
) as ObjectValue;
const object = (value: Json | undefined): ObjectValue => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value;
};
const array = (value: Json | undefined): Json[] => {
  assert.ok(Array.isArray(value));
  return value;
};
const components = object(document.components);
const schemas = object(components.schemas);
const paths = object(document.paths);
const methods = new Set(["get", "post", "put", "patch", "delete"]);
const sourceFiles = [
  "src/m05/runtime.ts",
  "src/m05/modules/points/http.ts",
  "src/m05/modules/activities/http.ts",
  "src/m05/modules/rewards/http.ts",
  "src/m05/modules/notifications/http.ts",
];
function resolve(value: Json | undefined): ObjectValue {
  const candidate = object(value);
  if (typeof candidate.$ref !== "string") return candidate;
  assert.ok(candidate.$ref.startsWith("#/"), "Only local contract references are expected");
  let target: Json | undefined = document;
  for (const key of candidate.$ref.slice(2).split("/")) target = object(target)[key];
  assert.ok(target, `Unresolved reference ${candidate.$ref}`);
  return object(target);
}
function registeredRoutes() {
  const routes = new Set<string>();
  for (const file of sourceFiles) {
    const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const controllers = [...source.matchAll(/@Controller\("([^"\n]+)"\)\s+class\s+(\w+)/g)];
    assert.ok(controllers.length, `No controller declarations found in ${file}`);
    for (let index = 0; index < controllers.length; index++) {
      const controller = controllers[index];
      // runtime registers messageControllers only for admin. M01 owns H5 inbox/capabilities.
      if (file.endsWith("notifications/http.ts") && controller[2] === "H5") continue;
      const body = source.slice(controller.index, controllers[index + 1]?.index);
      for (const route of body.matchAll(/@(Get|Post|Put|Patch|Delete)\("([^"\n]*)"\)/g)) {
        const path = ("/" + controller[1] + "/" + route[2])
          .replace(/^\/api\/v1/, "")
          .replace(/:([a-zA-Z]+)/g, "{$1}");
        routes.add(route[1].toLowerCase() + " " + path);
      }
    }
  }
  return routes;
}
function operations() {
  return Object.entries(paths).flatMap(([path, value]) =>
    Object.entries(object(value))
      .filter(([method]) => methods.has(method))
      .map(([method, value]) => ({ path, method, operation: object(value) })),
  );
}

test("M05 OpenAPI covers every registered route without reintroducing M01 inbox routes", () => {
  assert.equal(document.openapi, "3.0.3");
  assert.deepEqual(array(document.servers), [{ url: "/api/v1" }]);
  assert.deepEqual(
    new Set(operations().map(({ method, path }) => method + " " + path)),
    registeredRoutes(),
  );
  assert.equal(operations().length, 66);
  assert.equal(paths["/me/notifications"], undefined);
  assert.equal(paths["/notifications/capabilities"], undefined);
  assert.equal(paths["/dev/session"], undefined);
});

test("M05 OpenAPI references, parameter declarations and operation IDs are valid", () => {
  const ids = new Set<string>();
  function check(value: Json) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(check);
    if (value.$ref) resolve(value);
    if (value.required) {
      const properties = object(value.properties);
      for (const key of array(value.required)) {
        assert.equal(typeof key, "string");
        assert.ok(Object.hasOwn(properties, String(key)), `Missing required property ${key}`);
      }
    }
    Object.values(value).forEach(check);
  }
  // Schema required is an array; Parameter/RequestBody required is boolean.
  for (const value of Object.values(schemas)) check(value);
  for (const { path, operation } of operations()) {
    assert.equal(typeof operation.operationId, "string");
    const id = String(operation.operationId);
    assert.equal(ids.has(id), false, id);
    ids.add(id);
    const parameters = array(operation.parameters).map(resolve);
    const names = parameters.map((p) => `${p.in}:${p.name}`);
    assert.equal(new Set(names).size, names.length, id);
    for (const variable of path.matchAll(/\{([^}]+)\}/g)) {
      assert.ok(parameters.some((p) => p.in === "path" && p.name === variable[1] && p.required));
    }
    if (operation.requestBody) {
      const json = object(object(resolve(operation.requestBody).content)["application/json"]);
      check(json.schema);
      assert.equal(resolve(json.schema).additionalProperties, false);
    }
    for (const [status, response] of Object.entries(object(operation.responses))) {
      assert.match(status, /^[1-5][0-9]{2}$/);
      const value = resolve(response);
      assert.equal(typeof value.description, "string");
      if (value.content) check(object(object(value.content)["application/json"]).schema);
    }
  }
});

test("M05 OpenAPI preserves cookie auth, admin permissions, write CSRF and idempotency", () => {
  const cookie = resolve(object(components.securitySchemes).sessionCookie);
  assert.equal(cookie.in, "cookie");
  assert.equal(cookie.name, "qy_access");
  const publicPaths = new Set([
    "/activities", "/activities/{id}", "/activities/{id}/slots", "/points/rewards",
  ]);
  for (const { path, method, operation } of operations()) {
    const security = array(operation.security);
    const isPublic = method === "get" && publicPaths.has(path);
    assert.equal(security.length, isPublic ? 0 : 1, path);
    assert.equal(
      operation["x-permission"],
      isPublic ? "public" : path.startsWith("/admin/") ? "admin" : "authenticated_user",
    );
    if (method === "get") continue;
    const parameters = array(operation.parameters).map(resolve);
    for (const header of ["Origin", "X-CSRF-Token", "Idempotency-Key"]) {
      assert.ok(parameters.some((p) => p.in === "header" && p.name === header && p.required), path);
    }
    const conflict = resolve(object(operation.responses)["409"]);
    assert.ok(array(conflict["x-error-codes"]).includes("IDEMPOTENCY_CONFLICT"));
    assert.ok(array(conflict["x-error-codes"]).includes("REQUEST_IN_PROGRESS"));
    assert.ok(object(conflict.headers)["Retry-After"]);
  }
});

test("M05 OpenAPI captures ownership, version, pagination and asynchronous response differences", () => {
  const properties = (name: string) => object(resolve(schemas[name]).properties);
  assert.equal(properties("UserRedemption").userId, undefined);
  assert.equal(properties("AdminRedemptionDetail").code, undefined);
  assert.ok(properties("AdminRedemptionDetail").codeAvailable);
  assert.ok(properties("AdminRedemptionDetail").execution);
  assert.equal(object(properties("SaveCommunityProfile").version).minimum, 0);
  assert.deepEqual(array(resolve(schemas.EditPointRule).required), [
    "expectedRuleVersion", "rewardPoints", "active",
  ]);
  assert.deepEqual(array(resolve(schemas.EditActivity).required), ["version"]);
  const page = properties("BookingPage");
  assert.equal(object(page.nextCursor).nullable, true);
  assert.equal(page.total, undefined);
  const slots = object(object(paths["/activities/{id}/slots"]).get);
  for (const name of ["startDate", "endDate"]) {
    assert.ok(array(slots.parameters).map(resolve).some((p) => p.name === name && p.required));
  }
  assert.ok(object(object(object(paths["/admin/message-campaigns/{id}/send"]).post).responses)["202"]);
  const removed = object(object(object(paths["/me/blocks/{id}"]).delete).responses)["204"];
  assert.equal(object(removed).content, undefined);
  assert.deepEqual(array(object(properties("CampaignDetail").channel).enum), [
    "local_in_app", "external", "unavailable",
  ]);
});

test("M05 OpenAPI response enums match persisted states and the registered notification consumers", () => {
  const sql = readFileSync(new URL("../db/migrations/V001__baseline.sql", import.meta.url), "utf8")
    + readFileSync(new URL("../db/migrations/V005__m05_message_campaigns.sql", import.meta.url), "utf8");
  const properties = (name: string) => object(resolve(schemas[name]).properties);
  const checks: [string, string, string][] = [
    ["Booking", "status", "ck_m05_activity_bookings_status"],
    ["Redemption", "status", "ck_m05_point_redemptions_status"],
    ["Redemption", "fulfillmentStatus", "ck_m05_point_redemptions_fulfillment"],
    ["Campaign", "status", "ck_m05_campaign_status"],
    ["CampaignRecipient", "status", "ck_m05_recipient_status"],
  ];
  for (const [schema, field, constraint] of checks) {
    const declaration = sql.match(new RegExp("CONSTRAINT " + constraint + " CHECK[^\\n]+"));
    assert.ok(declaration, `Missing SQL constraint ${constraint}`);
    const values = [...declaration[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(array(resolve(properties(schema)[field]).enum), values, `${schema}.${field}`);
  }
  const worker = readFileSync(
    new URL("../src/m05/modules/notifications/worker.ts", import.meta.url), "utf8",
  );
  const registered = worker.match(/export const notificationEvents = \[([\s\S]*?)\];/);
  assert.ok(registered);
  assert.deepEqual(
    array(resolve(properties("NotificationEvent").eventType).enum),
    [...registered[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  );
});
