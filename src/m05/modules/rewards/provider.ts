import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {DomainError,requireValue} from '../../common/errors';
/** Adapter MUST guarantee stable redemptionId idempotency and irreversible final_failure.
 * query must never issue an entitlement. Unknown/not-found after a crashed submit stays unknown.
 * Production adapters own their immutable reward-to-SKU mapping and deployment validation. */
export interface RewardProvider {
 readonly mode:'unavailable'|'development'|'external';
 ready(rewardId:string):boolean;
 fulfill(input:{redemptionId:string;rewardId:string;userId:string}):Promise<ProviderResult>;
 query(input:{redemptionId:string;rewardId:string;userId:string}):Promise<ProviderResult>;
}
export type ProviderResult={status:'succeeded';code:string;reference:string}|{status:'final_failure';reference:string}|{status:'unknown';reason:string};
export class UnavailableProvider implements RewardProvider {
 readonly mode='unavailable' as const;ready(){return false;}
 async fulfill():Promise<ProviderResult>{throw new DomainError(503,'PROVIDER_UNAVAILABLE','数字权益供应商尚未配置');}
 async query():Promise<ProviderResult>{return {status:'unknown',reason:'PROVIDER_UNAVAILABLE'};}
}
export class CodeVault {
 private key:Buffer|null;
 constructor(key?:string){this.key=key?Buffer.from(key,'base64'):null;if(this.key)requireValue(this.key.length===32,503,'INVALID_CODE_KEY','兑换码加密密钥需为 32 字节');}
 get ready(){return Boolean(this.key);}
 encrypt(code:string,orderId:string,userId:string){requireValue(this.key,503,'CODE_KEY_NOT_CONFIGURED','兑换码加密服务尚未配置');requireValue(typeof code==='string'&&code.length>0&&code.length<=2048,503,'INVALID_PROVIDER_CODE','供应商兑换码格式无效');const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(Buffer.from(orderId+':'+userId));const data=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);return ['v1',nonce.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');}
 decrypt(value:string,orderId:string,userId:string){requireValue(this.key,503,'CODE_KEY_NOT_CONFIGURED','兑换码加密服务尚未配置');try{const [v,nonce,tag,data,...extra]=value.split('.');if(v!=='v1'||extra.length)throw Error('invalid');const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(nonce,'base64'));cipher.setAAD(Buffer.from(orderId+':'+userId));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8');}catch{throw new DomainError(503,'CODE_DECRYPT_FAILED','兑换码暂不可读取，请联系运营核对');}}
}
export const scenarios=['success','final_failure','timeout','late_result','duplicate'] as const;
export type Scenario=typeof scenarios[number];
/** Explicit local simulator: durable provider-side state survives API/worker restart.
 * Synchronous atomic rename makes each local request indivisible on this host.
 * No real entitlement is purchased or delivered. State is outside the business transaction. */
export class DevelopmentRewardProvider implements RewardProvider {
 readonly mode='development' as const;private dir:string;
 constructor(database:string,private vault:CodeVault){this.dir=resolve('.runtime','reward-provider-'+database);mkdirSync(this.dir,{recursive:true,mode:0o700});}
 ready(){return this.vault.ready;}
 private read<T>(name:string,fallback:T):T{const file=resolve(this.dir,name);return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):fallback;}
 private write(name:string,value:unknown){const file=resolve(this.dir,name),temp=file+'.'+randomBytes(8).toString('hex');writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,file);}
 scenario():Scenario{return this.read<{scenario:Scenario}>('config.json',{scenario:'success'}).scenario;}
 configure(scenario:unknown){requireValue(scenarios.includes(scenario as Scenario),422,'INVALID_PROVIDER_SCENARIO','测试场景无效');this.write('config.json',{scenario});return {scenario,mode:this.mode,warning:'仅测试权益，不能在线下兑换'};}
 async fulfill(input:{redemptionId:string;rewardId:string;userId:string}):Promise<ProviderResult>{
  const file=input.redemptionId+'.json';let row=this.read<null|{scenario:Scenario;queries:number;code:string|null;userId:string;rewardId:string}>(file,null);
  if(!row){const scenario=this.scenario(),code=['success','duplicate','late_result'].includes(scenario)?'TEST-ONLY-'+createHash('sha256').update(input.redemptionId).digest('hex').slice(0,20).toUpperCase():null;row={scenario,queries:0,code:code?this.vault.encrypt(code,input.redemptionId,input.userId):null,userId:input.userId,rewardId:input.rewardId};this.write(file,row);}
  requireValue(row.userId===input.userId&&row.rewardId===input.rewardId,409,'PROVIDER_KEY_CONFLICT','供应商业务键冲突');
  if(row.scenario==='final_failure')return {status:'final_failure',reference:'test:'+input.redemptionId};
  if(row.scenario==='timeout'||row.scenario==='late_result')return {status:'unknown',reason:'TEST_TIMEOUT'};
  return {status:'succeeded',code:this.vault.decrypt(row.code!,input.redemptionId,input.userId),reference:'test:'+input.redemptionId};
 }
 async query(input:{redemptionId:string;rewardId:string;userId:string}):Promise<ProviderResult>{const file=input.redemptionId+'.json',row=this.read<null|{scenario:Scenario;queries:number;code:string|null;userId:string;rewardId:string}>(file,null);if(!row)return {status:'unknown',reason:'NOT_FOUND_AFTER_UNCERTAIN_SUBMIT'};requireValue(row.userId===input.userId&&row.rewardId===input.rewardId,409,'PROVIDER_KEY_CONFLICT','供应商业务键冲突');row.queries++;this.write(file,row);if(row.scenario==='final_failure')return {status:'final_failure',reference:'test:'+input.redemptionId};if(row.scenario==='timeout')return {status:'unknown',reason:'TEST_TIMEOUT'};return {status:'succeeded',code:this.vault.decrypt(row.code!,input.redemptionId,input.userId),reference:'test:'+input.redemptionId};}
}
