import type { SqlTx, CommandContext } from "../../../contracts/shared_types.js";
import { idempotent } from "../../common/foundation.js";
import { sqlTx } from "../../common/ports.js";
import type { MysqlUnitOfWork } from "./database.js";
export interface CommandResult<T = unknown> {
  status: number;
  body: T;
}
export class Idempotency {
  constructor(_uow: MysqlUnitOfWork) {}
  run<T>(
    userId: string,
    method: string,
    path: string,
    key: string,
    body: unknown,
    work: (tx: SqlTx, ctx: CommandContext) => Promise<CommandResult<T>>,
    referencedUserIds: string[] = [],
  ): Promise<CommandResult<T>> {
    return idempotent(
      userId,
      method,
      path,
      key,
      body,
      (connection, ctx) => work(sqlTx(connection), ctx),
      200,
      referencedUserIds,
    );
  }
}
