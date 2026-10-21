import mysql, {Pool, PoolConnection, ResultSetHeader} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {SqlTx, DbParam, UnitOfWork, CommandContext} from '../../../contracts/shared';
import {Config} from './config';
import {requireValue} from './errors';
export const requestContext = new AsyncLocalStorage<{requestId:string}>();
export const BASELINE_SHA = '64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56';
export class Clock {
  now() {return new Date().toISOString();}
  businessDate(instant:string) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));}
}
export class Database {
  readonly pool:Pool;
  constructor(config:Config['db']) {this.pool=mysql.createPool({...config,connectionLimit:8,charset:'utf8mb4',timezone:'Z',dateStrings:true,decimalNumbers:false,multipleStatements:false});}
  async connection() {
    const c=await this.pool.getConnection();
    try {await c.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");await c.query("SET SESSION time_zone = '+00:00'");await c.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY,NO_ZERO_DATE,NO_ZERO_IN_DATE'");return c;}
    catch(e) {c.release();throw e;}
  }
  async query<T extends object>(sql:string,values:readonly DbParam[]=[]):Promise<T[]> {
    const c=await this.connection();try{return await wrap(c).query<T>(sql,values);}finally{c.release();}
  }
  close(){return this.pool.end();}
}
function wrap(c:PoolConnection):SqlTx {
  return Object.freeze({
    async query<T extends object>(sql:string,values:readonly DbParam[]):Promise<T[]> {const [rows]=await c.execute(sql,[...values]);return rows as T[];},
    async execute(sql:string,values:readonly DbParam[]){const [r]=await c.execute<ResultSetHeader>(sql,[...values]);return {affectedRows:r.affectedRows};}
  });
}
export class MysqlUnitOfWork implements UnitOfWork {
  private active = new AsyncLocalStorage<boolean>();
  constructor(readonly db:Database,readonly clock=new Clock()){}
  private async transaction<T>(run:(tx:SqlTx)=>Promise<T>,readOnly=false):Promise<T> {
    if (this.active.getStore()) throw new Error('NESTED_TRANSACTION_FORBIDDEN');
    return this.active.run(true,async()=>{
      for(let attempt=0;;attempt++) {
        const c=await this.db.connection();
        try {
          await c.query(`SET TRANSACTION ISOLATION LEVEL ${readOnly?'REPEATABLE READ':'READ COMMITTED'}`);
          await c.query(readOnly?'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY':'START TRANSACTION');
          const value=await run(wrap(c));await c.commit();return value;
        }catch(e) {
          await c.rollback();
          if(attempt<2 && ['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((e as {code:string}).code)) continue;
          throw e;
        }finally{c.release();}
      }
    });
  }
  runForUser<T>(userId:string,run:(tx:SqlTx,ctx:CommandContext)=>Promise<T>) {return this.runForUsers(userId,[],run);}
  runForUsers<T>(actorUserId:string,referencedUserIds:readonly string[],run:(tx:SqlTx,ctx:CommandContext)=>Promise<T>) {
    const operationNow=this.clock.now();
    const ctx:CommandContext={userId:actorUserId,operationNow,businessDate:this.clock.businessDate(operationNow),requestId:requestContext.getStore()?.requestId || randomUUID(),platform:'h5'};
    return this.transaction(async tx=>{
      for(const id of [...new Set([actorUserId,...referencedUserIds])].sort()) {
        const rows=await tx.query<{id:string;status:string}>('SELECT id,status FROM users WHERE id=? FOR UPDATE',[id]);
        requireValue(rows.length,404,'USER_NOT_FOUND','用户不存在');
        if(id===actorUserId) requireValue(rows[0].status==='active',403,'ACCOUNT_DISABLED','账号已停用');
      }
      return run(tx,ctx);
    });
  }
  runSystem<T>(scope:Parameters<UnitOfWork['runSystem']>[0],run:(tx:SqlTx,ctx:{operationNow:string;requestId:string})=>Promise<T>){
    if(!['auth_bootstrap','idempotency_claim','outbox_claim','delivery_claim','provider_job'].includes(scope)) throw new Error('INVALID_SYSTEM_SCOPE');
    const ctx={operationNow:this.clock.now(),requestId:requestContext.getStore()?.requestId || randomUUID()};return this.transaction(tx=>run(tx,ctx));
  }
  readSnapshot<T>(run:(tx:SqlTx)=>Promise<T>) {return this.transaction(run,true);}
}
