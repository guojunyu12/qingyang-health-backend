import { randomUUID } from "node:crypto";
import type {
  SqlTx,
  OutboxPort,
  OutboxInput,
  UserAdministrationPort,
  CommandContext,
} from "../../../contracts/shared_types.js";
import { outboxPort, userAdministrationPort } from "../../common/ports.js";
export class LocalOutbox implements OutboxPort {
  enqueueInTransaction(tx: SqlTx, input: OutboxInput) {
    return outboxPort.enqueueInTransaction(tx, input);
  }
}
export class LocalAudit {
  async record(
    tx: SqlTx,
    ctx: CommandContext,
    action: string,
    resourceType: string,
    resourceId: string | null,
    summary: Record<string, unknown>,
  ) {
    await tx.execute(
      "INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,request_id,change_summary,occurred_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        ctx.userId,
        action,
        resourceType,
        resourceId,
        ctx.requestId,
        JSON.stringify(summary),
        new Date(ctx.operationNow),
      ],
    );
  }
}
export class LocalUserAdministration implements UserAdministrationPort {
  disableInTransaction(tx: SqlTx, ctx: CommandContext, targetUserId: string) {
    return userAdministrationPort.disableInTransaction(tx, ctx, targetUserId);
  }
}
