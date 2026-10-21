import { AsyncLocalStorage } from "node:async_hooks";
import type {
  SqlTx,
  DbParam,
  UnitOfWork,
} from "../../../contracts/shared_types.js";
import { pool } from "../../common/database.js";
import { sqlTx, unitOfWorkPort } from "../../common/ports.js";
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export class Clock {
  now() {
    return new Date().toISOString();
  }
  businessDate(instant: string) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instant));
  }
}
/** Shared pool ownership and transaction lifecycle remain with M01. */
export class Database {
  readonly pool = pool;
  async query<T extends object>(
    sql: string,
    values: readonly DbParam[] = [],
  ): Promise<T[]> {
    const c = await pool.getConnection();
    try {
      await c.query("SET time_zone='+00:00'");
      return await sqlTx(c).query<T>(sql, values);
    } finally {
      c.release();
    }
  }
}
export class MysqlUnitOfWork implements UnitOfWork {
  constructor(
    readonly db: Database,
    readonly clock = new Clock(),
  ) {}
  runForUser: UnitOfWork["runForUser"] = (id, run) =>
    unitOfWorkPort.runForUser(id, run);
  runForUsers: UnitOfWork["runForUsers"] = (id, refs, run) =>
    unitOfWorkPort.runForUsers(id, refs, run);
  runSystem: UnitOfWork["runSystem"] = (scope, run) =>
    unitOfWorkPort.runSystem(scope, run);
  readSnapshot: UnitOfWork["readSnapshot"] = (run) =>
    unitOfWorkPort.readSnapshot(run);
}
