import {randomUUID} from 'node:crypto';
import type {SqlTx,OutboxPort,OutboxInput,UserAdministrationPort,CommandContext} from '../../../contracts/shared';
import {requireValue,UUID_RE} from './errors';
const events:Record<string,string[]>={
  'media.validate.requested.v1':['assetId'],
  'nutrition.recognition.requested.v1':['jobId','userId','assetId'],
  'companion.reply.requested.v1':['assistantMessageId','sessionId','userId'],
  'training.reminder.due.v1':['reminderId','userId','reminderVersion','scheduledAt'],
  'activity.booking.confirmed.v1':['bookingId','bookingEventId','slotId','userId'],
  'activity.booking.canceled.v1':['bookingId','bookingEventId','slotId','userId'],
  'activity.slot.canceled.v1':['slotId','slotVersion','actorUserId'],
  'points.redemption.requested.v1':['redemptionId','userId'],
  'points.redemption.finished.v1':['redemptionId','userId','redemptionVersion','status']
};
export class LocalOutbox implements OutboxPort {
  async enqueueInTransaction(tx:SqlTx,input:OutboxInput) {
    const allowed=events[input.eventType];const keys=Object.keys(input.payload);
    requireValue(allowed && input.schemaVersion===1 && keys.length===allowed.length && keys.every(k=>allowed.includes(k)),422,'INVALID_EVENT','事件必须符合公共白名单与最小载荷契约');
    for(const [key,value] of Object.entries(input.payload)) {
      if(key.endsWith('Id')) requireValue(typeof value==='string' && UUID_RE.test(value),422,'INVALID_EVENT','事件 ID 必须是 UUID v4');
      if(key.endsWith('Version')) requireValue(Number.isSafeInteger(value) && Number(value)>0,422,'INVALID_EVENT','事件版本必须为正整数');
      if(key==='status') requireValue(['fulfilled','refunded'].includes(String(value)),422,'INVALID_EVENT','不支持的履约结果');
      if(key==='scheduledAt') requireValue(typeof value==='string' && /Z$/.test(value) && Number.isFinite(Date.parse(value)),422,'INVALID_EVENT','需要 UTC 时间戳');
    }
    const payload=JSON.stringify(input.payload);
    await tx.execute(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,event_key,schema_version,payload) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,[randomUUID(),input.eventType,input.aggregateType,input.aggregateId,input.eventKey,input.schemaVersion,payload]);
    const [r]=await tx.query<{id:string;event_type:string;aggregate_type:string;aggregate_id:string;payload:object}>('SELECT id,event_type,aggregate_type,aggregate_id,payload FROM outbox_events WHERE event_key=?',[input.eventKey]);
    const samePayload=Object.entries(input.payload).every(([k,v])=>(r.payload as Record<string,unknown>)[k]===v);
    requireValue(r.event_type===input.eventType && r.aggregate_type===input.aggregateType && r.aggregate_id===input.aggregateId && samePayload,409,'EVENT_KEY_CONFLICT','事件键已对应不同事件');
    return {id:r.id};
  }
}
export class LocalAudit {
  async record(tx:SqlTx,ctx:CommandContext,action:string,resourceType:string,resourceId:string|null,summary:Record<string,unknown>) {
    await tx.execute('INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,request_id,change_summary,occurred_at) VALUES (?,?,?,?,?,?,?,?)',[randomUUID(),ctx.userId,action,resourceType,resourceId,ctx.requestId,JSON.stringify(summary),new Date(ctx.operationNow)]);
  }
}
export class LocalUserAdministration implements UserAdministrationPort {
  async disableInTransaction(tx:SqlTx,ctx:CommandContext,targetUserId:string) {
    // Caller must use runForUsers(actor, [target]) before entering this port.
    const role=await tx.query('SELECT id FROM user_roles WHERE user_id=? AND role=?',[ctx.userId,'admin']);
    requireValue(role.length,403,'ADMIN_REQUIRED','仅管理员可停用账号');
    await tx.execute("UPDATE users SET status='disabled' WHERE id=? AND status='active'",[targetUserId]);
    await tx.execute('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',[new Date(ctx.operationNow),targetUserId]);
    await new LocalAudit().record(tx,ctx,'user.disabled','users',targetUserId,{reason:'development_adapter'});
  }
}
