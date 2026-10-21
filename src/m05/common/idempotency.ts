import {createHash, randomUUID} from 'node:crypto';
import {MysqlUnitOfWork} from './database';
import {DomainError,requireValue,UUID_RE} from './errors';
import type {SqlTx,CommandContext} from '../../../contracts/shared';
function canonical(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
interface Row {id:string;body_hash:string;status:string;response_status:number;response_body:unknown;locked_by:string;lease_version:number;alive:number;}
export interface CommandResult<T=unknown>{status:number;body:T;}
export class Idempotency {
  constructor(private readonly uow:MysqlUnitOfWork){}
  async run<T>(userId:string,method:string,path:string,key:string,body:unknown,work:(tx:SqlTx,ctx:CommandContext)=>Promise<CommandResult<T>>,referencedUserIds:string[]=[]):Promise<CommandResult<T>> {
    requireValue(UUID_RE.test(key),422,'INVALID_IDEMPOTENCY_KEY','Idempotency-Key 必须为小写 UUID v4');
    const hash=createHash('sha256').update(canonical(body)).digest('hex');
    const owner=randomUUID();
    const claim=await this.uow.runSystem('idempotency_claim',async tx=>{
      const scope=[userId,method,path,key];
      // Duplicate insert deliberately does not change body, result or the incumbent lease.
      await tx.execute(`INSERT INTO idempotency_requests (id,principal_key,method,request_path,idempotency_key,body_hash,expires_at,locked_by,locked_until)
        VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3)+INTERVAL 1 DAY,?,UTC_TIMESTAMP(3)+INTERVAL 30 SECOND) ON DUPLICATE KEY UPDATE id=id`,[randomUUID(),...scope,hash,owner]);
      const [r]=await tx.query<Row>('SELECT *,locked_until>UTC_TIMESTAMP(3) AS alive FROM idempotency_requests WHERE principal_key=? AND method=? AND request_path=? AND idempotency_key=? FOR UPDATE',scope);
      requireValue(r.body_hash===hash,409,'IDEMPOTENCY_CONFLICT','相同幂等键不能用于不同内容');
      if(r.status!=='processing') return {row:r,cached:true};
      if(r.locked_by!==owner) {
        requireValue(!r.alive,409,'REQUEST_IN_PROGRESS','请求正在处理，请使用原幂等键重试');
        await tx.execute('UPDATE idempotency_requests SET locked_by=?,locked_until=UTC_TIMESTAMP(3)+INTERVAL 30 SECOND,lease_version=lease_version+1 WHERE id=?',[owner,r.id]);
        r.lease_version=Number(r.lease_version)+1;
      }
      return {row:r,cached:false};
    });
    const result=(r:Row):CommandResult<T>=>({status:r.response_status,body:(typeof r.response_body==='string'?JSON.parse(r.response_body):r.response_body) as T});
    if(claim.cached) {const r=result(claim.row);if(r.status>=400){const b=r.body as {code:string;message:string};throw new DomainError(r.status,b.code,b.message);}return r;}
    const verify=async(tx:SqlTx)=>{
      const [r]=await tx.query<Row>('SELECT *,locked_until>UTC_TIMESTAMP(3) AS alive FROM idempotency_requests WHERE id=? FOR UPDATE',[claim.row.id]);
      requireValue(r.status==='processing' && r.locked_by===owner && Number(r.lease_version)===Number(claim.row.lease_version) && r.alive,409,'REQUEST_IN_PROGRESS','处理租约已过期，请使用原幂等键重试');
    };
    const finish=async(tx:SqlTx,r:CommandResult)=>{await tx.execute('UPDATE idempotency_requests SET status=?,response_status=?,response_body=?,locked_by=NULL,locked_until=NULL WHERE id=?',[r.status<400?'completed':'failed',r.status,JSON.stringify(r.body),claim.row.id]);};
    try {
      return await this.uow.runForUsers(userId,referencedUserIds,async(tx,ctx)=>{await verify(tx);const r=await work(tx,ctx);await finish(tx,r);return r;});
    } catch(e) {
      if(e instanceof DomainError && e.status>=400 && e.status<500 && e.code!=='REQUEST_IN_PROGRESS') {
        await this.uow.runSystem('idempotency_claim',async tx=>{await verify(tx);await finish(tx,{status:e.status,body:{code:e.code,message:e.message}});});
      } else {
        // Unknown/rolled-back work remains retryable; release only our fenced lease.
        await this.uow.runSystem('idempotency_claim',async tx=>{await tx.execute('UPDATE idempotency_requests SET locked_until=UTC_TIMESTAMP(3) WHERE id=? AND status=? AND locked_by=? AND lease_version=?',[claim.row.id,'processing',owner,claim.row.lease_version]);});
      }
      throw e;
    }
  }
}
