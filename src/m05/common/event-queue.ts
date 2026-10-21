import { randomUUID } from "node:crypto";
import { MysqlUnitOfWork } from "./database.js";
import type { SqlTx } from "../../../contracts/shared_types.js";
export type EventLease = {
  id: string;
  event_type: string;
  aggregate_id: string;
  event_key: string;
  payload: Record<string, unknown>;
  locked_by: string;
  lease_version: number;
};
/** Claims commit before user/resource locks; callers must fence before side effects. */
export class EventQueue {
  constructor(
    readonly uow: MysqlUnitOfWork,
    private types: readonly string[],
  ) {}
  async claim(id?: string): Promise<EventLease | null> {
    return this.uow.runSystem("outbox_claim", async (tx) => {
      const [r] = await tx.query<EventLease>(
        `SELECT * FROM outbox_events WHERE event_type IN (${this.types.map(() => "?").join(",")}) ${id ? "AND id=?" : ""} AND ((status='pending' AND next_attempt_at<=UTC_TIMESTAMP(3)) OR (status='processing' AND locked_until<=UTC_TIMESTAMP(3))) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [...this.types, ...(id ? [id] : [])],
      );
      if (!r) return null;
      const token = randomUUID();
      await tx.execute(
        "UPDATE outbox_events SET status='processing',locked_by=?,locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),lease_version=lease_version+1,attempts=attempts+1 WHERE id=?",
        [token, r.id],
      );
      return {
        ...r,
        locked_by: token,
        lease_version: Number(r.lease_version) + 1,
      };
    });
  }
  async valid(tx: SqlTx, l: EventLease) {
    return Boolean(
      (
        await tx.query(
          "SELECT id FROM outbox_events WHERE id=? AND status=? AND locked_by=? AND lease_version=? AND locked_until>UTC_TIMESTAMP(3) FOR UPDATE",
          [l.id, "processing", l.locked_by, l.lease_version],
        )
      ).length,
    );
  }
  async ack(l: EventLease) {
    return this.uow.runSystem("outbox_claim", async (tx) => {
      if (!(await this.valid(tx, l))) return false;
      await tx.execute(
        "UPDATE outbox_events SET status='published',published_at=UTC_TIMESTAMP(3),locked_by=NULL,locked_until=NULL,last_error_code=NULL WHERE id=?",
        [l.id],
      );
      return true;
    });
  }
  async retry(l: EventLease, code = "CONSUMER_ERROR") {
    return this.uow.runSystem("outbox_claim", async (tx) => {
      if (!(await this.valid(tx, l))) return;
      await tx.execute(
        "UPDATE outbox_events SET status='pending',next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),locked_by=NULL,locked_until=NULL,last_error_code=? WHERE id=?",
        [code, l.id],
      );
    });
  }
}
