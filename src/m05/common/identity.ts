import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Request,Response} from 'express';
import {Config} from './config';
import {Database,MysqlUnitOfWork} from './database';
import {Idempotency} from './idempotency';
import {DomainError,requireValue,UUID_RE} from './errors';
import {LocalAudit} from './ports';
import {PointsService} from '../modules/points/points';
export const FIXTURES={user_a:'a0000000-0000-4000-8000-000000000001',user_b:'a0000000-0000-4000-8000-000000000002',admin:'a0000000-0000-4000-8000-000000000003'} as const;
export interface Identity {id:string;nickname:string;roles:string[];sessionId:string;csrfToken:string;}
export interface IdentityPort {resolve(req:Request):Promise<Identity>;}
export function safeEqual(a:string,b:string) {const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb);}
export class DevelopmentIdentity implements IdentityPort {
  readonly cookieName:string;
  constructor(private config:Config,private db:Database,private uow:MysqlUnitOfWork,private commands:Idempotency){this.cookieName=`m05_${config.audience}_session`;}
  private sign(value:string) {return createHmac('sha256',this.config.sessionSecret).update(`${this.config.audience}:${value}`).digest('hex');}
  private cookieValue(id:string){return `${id}.${this.sign(id)}`;}
  private sessionId(req:Request):string|null {
    const value=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1);
    if(!value) return null;
    const [id,signature,...extra]=value.split('.');
    return UUID_RE.test(id) && !extra.length && safeEqual(signature||'',this.sign(id))?id:null;
  }
  async resolve(req:Request):Promise<Identity> {
    const id=this.sessionId(req);requireValue(id,401,'UNAUTHENTICATED','请先选择测试身份');
    const [row]=await this.db.query<{id:string;nickname:string}>(`SELECT u.id,u.nickname FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND u.status='active' AND u.deleted_at IS NULL`,[id]);
    requireValue(row,401,'UNAUTHENTICATED','会话已失效，请重新选择身份');
    const roles=await this.db.query<{role:string}>('SELECT role FROM user_roles WHERE user_id=? ORDER BY role',[row.id]);
    return {...row,roles:roles.map(r=>r.role),sessionId:id,csrfToken:this.sign(`csrf:${id}`)};
  }
  authorizeWrite(req:Request,identity:Identity) {
    requireValue(req.headers.origin===this.config.origin,403,'ORIGIN_FORBIDDEN','写入请求来源不匹配');
    requireValue(safeEqual(String(req.headers['x-csrf-token']||''),identity.csrfToken),403,'CSRF_INVALID','CSRF 校验未通过');
  }
  authorizeDev(req:Request) {
    requireValue(this.config.devIdentity && !this.config.production,404,'NOT_FOUND','接口不存在');
    requireValue(req.headers.origin===this.config.origin,403,'ORIGIN_FORBIDDEN','测试入口仅允许当前站点');
    requireValue(safeEqual(String(req.headers['x-dev-token']||''),this.config.devToken),403,'DEV_TOKEN_REQUIRED','缺少有效本地开发令牌');
  }
  async login(req:Request,res:Response,profileKey:keyof typeof FIXTURES) {
    this.authorizeDev(req);
    const userId=FIXTURES[profileKey];requireValue(userId,422,'INVALID_PROFILE','请选择固定测试身份');
    const previous=await this.resolve(req).catch(e=>{if(e instanceof DomainError && e.status===401)return null;throw e;});
    const r=await this.commands.run(userId,'POST',`/api/dev/session:${this.config.audience}`,String(req.headers['idempotency-key']||''),{profileKey},async(tx,ctx)=>{
      await new PointsService().ensureAccountInTransaction(tx,{userId});
      const sessionId=randomUUID();
      if(previous) await tx.execute('UPDATE user_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL',[new Date(ctx.operationNow),previous.sessionId]);
      await tx.execute('INSERT INTO user_sessions (id,user_id,device_id,platform,refresh_family_id,expires_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3)+INTERVAL 8 HOUR)',[sessionId,userId,randomUUID(),'h5',randomUUID()]);
      await new LocalAudit().record(tx,ctx,'dev.session.created','user_sessions',sessionId,{audience:this.config.audience,profileKey});
      return {status:201,body:{sessionId}};
    },previous?[previous.id]:[]);
    // A cached command cannot resurrect a revoked session or replace a newer login.
    const active=await this.db.query('SELECT id FROM user_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3)',[r.body.sessionId]);
    requireValue(active.length,409,'SESSION_SUPERSEDED','该登录操作已失效，请发起新操作');
    res.cookie(this.cookieName,this.cookieValue(r.body.sessionId),{httpOnly:true,sameSite:'strict',secure:this.config.production,path:'/',maxAge:8*60*60*1000});
    return {status:r.status,body:{profileKey,csrfToken:this.sign(`csrf:${r.body.sessionId}`)}};
  }
  async logout(req:Request,res:Response) {
    this.authorizeDev(req);const identity=await this.resolve(req);this.authorizeWrite(req,identity);
    await this.uow.runForUser(identity.id,async(tx,ctx)=>{
      await tx.execute('UPDATE user_sessions SET revoked_at=? WHERE id=?',[new Date(ctx.operationNow),identity.sessionId]);
      await new LocalAudit().record(tx,ctx,'dev.session.revoked','user_sessions',identity.sessionId,{audience:this.config.audience});
    });
    res.clearCookie(this.cookieName,{httpOnly:true,sameSite:'strict',secure:this.config.production,path:'/'});
  }
}
export class UnconfiguredM01Identity implements IdentityPort {
  async resolve(_req:Request):Promise<Identity>{throw new DomainError(401,'IDENTITY_NOT_CONFIGURED','请接入 M01 身份服务');}
}
