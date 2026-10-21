import {randomUUID} from 'node:crypto';
import type {SqlTx,CommandContext,PointsPort,PointsQueryPort,PointAccountDto,PointAwardDto,AwardInput,TaskCode,TaskDto} from '../../../../contracts/shared';
import {Clock} from '../../common/database';
import {requireValue,UUID_RE} from '../../common/errors';
export const taskCodes:TaskCode[]=['daily_checkin','daily_water','daily_meal','course_workout'];
const sourceCodes={checkin:'daily_checkin',water_recorded:'daily_water',meal_confirmed:'daily_meal',workout_completed:'course_workout'} as const;
interface AccountRow {balance:number;lifetime_earned:number;lifetime_spent:number;version:number;}
interface AwardRow {id:string;task_code:TaskCode;points:number;business_date:string;scope_key:string;created_at:string;}
export interface RuleRow {code:TaskCode;title:string;description:string;reward_points:number;scope:string;active:number;rule_version:number;}
export interface TaskView extends TaskDto {active:boolean;ruleVersion:number;awardedPoints:number;}
export const asInstant=(s:string)=>new Date(s.includes('T')?s:s.replace(' ','T')+'Z').toISOString();
export const accountDto=(r:AccountRow):PointAccountDto=>({balance:Number(r.balance),lifetimeEarned:Number(r.lifetime_earned),lifetimeSpent:Number(r.lifetime_spent),version:Number(r.version)});
const awardDto=(r:AwardRow):PointAwardDto=>({id:r.id,taskCode:r.task_code,points:Number(r.points),businessDate:r.business_date,scopeKey:r.scope_key});
export const ruleDto=(r:RuleRow)=>({code:r.code,title:r.title,description:r.description,rewardPoints:Number(r.reward_points),scope:r.scope,active:Boolean(r.active),ruleVersion:Number(r.rule_version)});
export class PointsService implements PointsPort,PointsQueryPort {
  constructor(private readonly checkpoint?:(point:'after_account'|'before_ledger')=>void){}
  async ensureAccountInTransaction(tx:SqlTx,{userId}:{userId:string}):Promise<PointAccountDto>{
    requireValue(UUID_RE.test(userId),422,'INVALID_USER','用户编号无效');
    await tx.execute('INSERT INTO point_accounts (id,user_id) VALUES (?,?) ON DUPLICATE KEY UPDATE user_id=user_id',[randomUUID(),userId]);
    const [r]=await tx.query<AccountRow>('SELECT balance,lifetime_earned,lifetime_spent,version FROM point_accounts WHERE user_id=? FOR UPDATE',[userId]);return accountDto(r);
  }
  async account(tx:SqlTx,userId:string):Promise<PointAccountDto>{
    const [r]=await tx.query<AccountRow>('SELECT balance,lifetime_earned,lifetime_spent,version FROM point_accounts WHERE user_id=?',[userId]);
    requireValue(r,503,'POINT_ACCOUNT_NOT_INITIALIZED','积分账户需要先初始化');return accountDto(r);
  }
  async awardInTransaction(tx:SqlTx,ctx:CommandContext,input:AwardInput):Promise<{awards:PointAwardDto[];account:PointAccountDto}>{
    requireValue(input && Object.hasOwn(sourceCodes,input.type),422,'INVALID_AWARD_INPUT','不支持的奖励事件');
    const fields=Object.keys(input);requireValue(fields.length===(input.type==='checkin'?1:2)&&fields.every(k=>['type','sourceId'].includes(k)),422,'INVALID_AWARD_INPUT','奖励只接受事件类型和来源编号');
    requireValue(new Clock().businessDate(ctx.operationNow)===ctx.businessDate,422,'INVALID_CONTEXT','事务业务日与时间不一致');
    let scopeKey='',eligible=true;
    if(input.type!=='checkin'){
      requireValue(UUID_RE.test(input.sourceId),422,'INVALID_SOURCE','来源编号无效');
      if(input.type==='water_recorded'||input.type==='meal_confirmed'){
        const table=input.type==='water_recorded'?'water_records':'meals';
        const [source]=await tx.query<{user_id:string;business_date:string;recorded_at:string;deleted_at:string|null}>(`SELECT user_id,business_date,recorded_at,deleted_at FROM ${table} WHERE id=? FOR UPDATE`,[input.sourceId]);
        requireValue(source&&source.user_id===ctx.userId&&!source.deleted_at,404,'SOURCE_NOT_FOUND','找不到本人有效来源');
        requireValue(asInstant(source.recorded_at)<=ctx.operationNow,422,'FUTURE_SOURCE','不能奖励未来发生的记录');
        if(input.type==='meal_confirmed'){
          const items=await tx.query('SELECT id FROM meal_items WHERE meal_id=? LIMIT 1',[input.sourceId]);requireValue(items.length,422,'INVALID_MEAL','确认的餐记录需要食物明细');
        }
        eligible=source.business_date===ctx.businessDate;
      }else{
        const [source]=await tx.query<{user_id:string;course_id:string;status:string;business_date:string;ended_at:string|null;reward_eligible:number;active_duration_seconds:number;reward_threshold_seconds:number;duration_snapshot_seconds:number}>('SELECT user_id,course_id,status,business_date,ended_at,reward_eligible,active_duration_seconds,reward_threshold_seconds,duration_snapshot_seconds FROM workout_sessions WHERE id=? FOR UPDATE',[input.sourceId]);
        requireValue(source&&source.user_id===ctx.userId,404,'SOURCE_NOT_FOUND','找不到本人的训练来源');
        requireValue(source.status==='completed' && source.ended_at,422,'WORKOUT_NOT_COMPLETED','训练尚未完成');
        requireValue(asInstant(source.ended_at)<=ctx.operationNow,422,'FUTURE_SOURCE','不能奖励未来完成的训练');
        const course=await tx.query('SELECT id FROM training_courses WHERE id=?',[source.course_id]);requireValue(course.length,422,'INVALID_COURSE','课程来源不存在');
        scopeKey=source.course_id;
        eligible=source.business_date===ctx.businessDate && Boolean(source.reward_eligible) && source.active_duration_seconds>=source.reward_threshold_seconds && source.reward_threshold_seconds===Math.ceil(source.duration_snapshot_seconds*0.8);
      }
    }
    const code=sourceCodes[input.type];
    // Shared rule lock gives each award one coherent rule snapshot, and prevents a concurrent edit from racing that snapshot.
    const [rule]=await tx.query<RuleRow>('SELECT * FROM point_task_definitions WHERE code=? FOR SHARE',[code]);
    requireValue(rule,503,'POINT_RULE_NOT_INITIALIZED','积分规则尚未初始化');
    requireValue(rule.scope===(code==='course_workout'?'daily_course':'daily'),503,'RULE_SCOPE_MISMATCH','任务范围与统一契约不一致');
    const account=await this.ensureAccountInTransaction(tx,{userId:ctx.userId});
    if(!eligible)return {awards:[],account};
    const prior=await tx.query<AwardRow>('SELECT * FROM point_task_awards WHERE user_id=? AND task_code=? AND business_date=? AND scope_key=?',[ctx.userId,code,ctx.businessDate,scopeKey]);
    if(prior.length)return {awards:prior.map(awardDto),account};
    if(!rule.active){requireValue(input.type!=='checkin',409,'TASK_DISABLED','签到任务已暂停');return {awards:[],account};}
    const points=Number(rule.reward_points),balance=account.balance+points,earned=account.lifetimeEarned+points;
    requireValue(Number.isSafeInteger(points)&&points>0&&balance<=2147483647&&earned<=2147483647&&account.version<2147483647,409,'POINT_LIMIT_EXCEEDED','积分账户达到整数上限');
    const id=randomUUID(),createdAt=new Date(ctx.operationNow);
    await tx.execute('INSERT INTO point_task_awards (id,user_id,task_code,business_date,scope_key,rule_version,points,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[id,ctx.userId,code,ctx.businessDate,scopeKey,rule.rule_version,points,input.type,input.type==='checkin'?null:input.sourceId,createdAt]);
    await tx.execute('UPDATE point_accounts SET balance=?,lifetime_earned=?,version=version+1,updated_at=? WHERE user_id=?',[balance,earned,createdAt,ctx.userId]);
    this.checkpoint?.('after_account');this.checkpoint?.('before_ledger');
    await tx.execute('INSERT INTO point_ledger (id,user_id,delta,balance_after,reason,business_date,business_type,business_id,event_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[randomUUID(),ctx.userId,points,balance,rule.title,ctx.businessDate,'task_award',id,`task_award:${code}:${ctx.businessDate}:${scopeKey}`,createdAt]);
    return {awards:[{id,taskCode:code,points,businessDate:ctx.businessDate,scopeKey}],account:{balance,lifetimeEarned:earned,lifetimeSpent:account.lifetimeSpent,version:account.version+1}};
  }
  async tasks(tx:SqlTx,userId:string,date:string):Promise<TaskView[]>{
    const rules=await tx.query<RuleRow>('SELECT * FROM point_task_definitions ORDER BY id',[]);
    const awards=await tx.query<AwardRow>('SELECT * FROM point_task_awards WHERE user_id=? AND business_date=? ORDER BY created_at,id',[userId,date]);
    return taskCodes.map(code=>{
      const rule=rules.find(r=>r.code===code);requireValue(rule,503,'POINT_RULE_NOT_INITIALIZED','积分任务尚未初始化');
      const matches=awards.filter(a=>a.task_code===code);
      const paths={daily_water:'/health',daily_meal:'/nutrition',course_workout:'/training'};
      return {code,title:rule.title,description:rule.description,rewardPoints:Number(rule.reward_points),progress:matches.length,target:1,status:matches.length?'completed':'pending',completedAt:matches.length?asInstant(matches[0].created_at):null,action:code==='daily_checkin'?{type:'checkin'}:{type:'navigate',path:paths[code]},active:Boolean(rule.active),ruleVersion:Number(rule.rule_version),awardedPoints:matches.reduce((s,a)=>s+Number(a.points),0)};
    });
  }
  async consecutiveCheckinDays(tx:SqlTx,userId:string,asOfDate:string):Promise<number>{
    const rows=await tx.query<{business_date:string}>('SELECT business_date FROM point_task_awards WHERE user_id=? AND task_code=? AND business_date<=? ORDER BY business_date DESC',[userId,'daily_checkin',asOfDate]);
    let date=asOfDate,count=0;const previous=(d:string)=>new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10);
    if(rows[0]?.business_date!==date)date=previous(date);
    for(const row of rows){if(row.business_date!==date)break;count++;date=previous(date);}return count;
  }
}
