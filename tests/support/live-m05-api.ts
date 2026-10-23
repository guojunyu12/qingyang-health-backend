/** Explicit isolated browser harness; never imported by production entry points. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const database = process.env.DB_NAME;
if (
  process.env.NODE_ENV === "production" ||
  process.env.AUTH_NO_LISTEN !== "1" ||
  process.env.M05_LIVE_TEST !== "1" ||
  !database?.endsWith("_test") ||
  process.env.M05_E2E_CONFIRM_DATABASE !== database ||
  !["127.0.0.1", "localhost"].includes(process.env.DB_HOST ?? "")
) {
  throw new Error("M05 live harness requires an acknowledged, isolated local test database");
}

const { IdentityService } = await import("../../src/modules/identity/service.js");
const { createApp } = await import("../../src/main.js");
const { pool } = await import("../../src/common/database.js");
const { redis } = await import("../../src/modules/identity/limiter.js");
const { digest } = await import("../../src/modules/identity/crypto.js");
const directory = resolve(".local");
await mkdir(directory, { recursive: true });
const mailbox: Record<string, { code: string }> = {};
const mailPath = resolve(directory, "m05-browser-mail.json");
let mailWrites = Promise.resolve();
const identity = new IdentityService(async (email, code) => {
  mailbox[email] = { code };
  mailWrites = mailWrites.then(async () => {
    const temporary = `${mailPath}.${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(mailbox), { mode: 0o600 });
    await rename(temporary, mailPath);
  });
  await mailWrites;
});
const app = await createApp(identity);

async function seedAccount(label: string, admin: boolean) {
  const email = `m05-${label}-${randomUUID()}@example.test`;
  const challenge = await identity.send(email, `m05-live-${randomUUID()}`);
  const auth = await identity.login(challenge.challengeId, mailbox[email].code, randomUUID());
  if (admin) {
    await pool.execute("INSERT INTO user_roles(id,user_id,role) VALUES (?,?,'admin')", [
      randomUUID(), auth.user.id,
    ]);
  }
  // The first login only prepares synthetic test accounts; browser login remains real.
  await redis.del(`auth:${database}:email60:${digest(email)}`);
  return { id: auth.user.id, email };
}

const fixtures = {
  adminA: await seedAccount("admin-a", true),
  adminB: await seedAccount("admin-b", true),
  user: await seedAccount("user", false),
};
const worker = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let cleanup: Promise<void> | undefined;
function shutdown() {
  cleanup ??= (async () => {
    worker.kill("SIGTERM");
    await app.close();
    await pool.end();
    if (redis.isOpen) await redis.quit();
  })();
  return cleanup;
}
const close = () => void shutdown().then(() => process.exit(0));
process.once("SIGTERM", close);
process.once("SIGINT", close);
try {
  await new Promise<void>((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error("M05 test worker startup timeout")), 15000);
    worker.once("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`M05 test worker exited: ${code}`));
    });
    worker.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Outbox dispatcher started")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
  });
  worker.stderr.on("data", () => console.error("M05 test worker reported an error"));
  const port = Number(process.env.M05_LIVE_PORT ?? "4302");
  await app.listen(port, "127.0.0.1");
  await writeFile(
    resolve(directory, "m05-browser-fixture.json"),
    JSON.stringify({ ...fixtures, apiPort: port, workerStarted: true }),
    { mode: 0o600 },
  );
  console.log(`M05 isolated browser API and unified Worker ready on ${port}`);
} catch (error) {
  await shutdown();
  throw error;
}
