import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Clock} from '../../common/database';
import {DomainError,exactBody,requireValue,UUID_RE} from '../../common/errors';
import {LocalAudit} from '../../common/ports';
import {FIXTURES} from '../../common/identity';
import type {SqlTx,CommandContext} from '../../../../contracts/shared';
import {PointsService} from './points';
import {dateValue} from './queries';
export class DevelopmentClock extends Clock {
  private path:string;
  constructor(database:string){super();this.path=join(process.cwd(),'.runtime',`clock-${database}.json`);}
  override now(){try{return JSON.parse(readFileSync(this.path,'utf8')).instant || super.now();}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return super.now();throw e;}}
  set(instant:string|null){mkdirSync(join(process.cwd(),'.runtime'),{recursive:true});const tmp=this.path+'.'+randomUUID();writeFileSync(tmp,JSON.stringify({instant}),{mode:0o600});renameSync(tmp,this.path);}
}
export async function runScenario(tx:SqlTx,ctx:CommandContext,body:Record<string,unknown>){
  exactBody(body,['scenario','fixtureKey','date','courseKey','sourceId','faultPoint']);
  requireValue(Object.entries(FIXTURES).some(([key,id])=>key===body.fixtureKey&&id===ctx.userId),422,'FIXTURE_MISMATCH','测试来源只能归属当前固定测试身份');
  requireValue(['water','meal','workout','workout_short','delete_water','delete_meal'].includes(String(body.scenario)),422,'INVALID_SCENARIO','测试场景无效');
  requireValue(body.faultPoint===undefined||['after_source','after_account','before_ledger'].includes(String(body.faultPoint)),422,'INVALID_FAULT','故障点无效');
  const fail=(point:string)=>{if(body.faultPoint===point)throw new DomainError(503,'INJECTED_FAILURE','已注入失败，整个来源与积分事务回滚');};
  const date=body.date===undefined?ctx.businessDate:dateValue(body.date);
  requireValue(date<=ctx.businessDate&&Date.parse(ctx.businessDate)-Date.parse(date)<=30*86400000,422,'INVALID_SCENARIO_DATE','测试日期仅限当前日及过去 30 天');
  const when=date===ctx.businessDate?new Date(ctx.operationNow):new Date(date+'T04:00:00.000Z');
  const points=new PointsService(fail),audit=new LocalAudit();
  if(String(body.scenario).startsWith('delete_')){
    requireValue(typeof body.sourceId==='string'&&UUID_RE.test(body.sourceId),422,'INVALID_SOURCE','请选择本工具创建的记录');
    const table=body.scenario==='delete_water'?'water_records':'meals';
    const created=await tx.query('SELECT id FROM audit_logs WHERE actor_user_id=? AND action=? AND resource_id=? AND resource_type=?',[ctx.userId,'dev.points.source',body.sourceId,table]);
    requireValue(created.length,404,'SOURCE_NOT_FOUND','仅可删除本人通过工具生成的来源');
    await tx.execute(`UPDATE ${table} SET deleted_at=? WHERE id=? AND user_id=?`,[new Date(ctx.operationNow),body.sourceId,ctx.userId]);
    fail('after_source');await audit.record(tx,ctx,'dev.points.source_deleted',table,body.sourceId,{testOnly:true});
    return {sourceId:body.sourceId,deleted:true,awards:[],account:await points.account(tx,ctx.userId)};
  }
  requireValue(body.sourceId===undefined,422,'INVALID_SOURCE','创建来源不接受已有编号');
  const id=randomUUID();let type:'water_recorded'|'meal_confirmed'|'workout_completed',table:string;
  if(body.scenario==='water'){
    table='water_records';type='water_recorded';await tx.execute('INSERT INTO water_records (id,user_id,amount_ml,recorded_at,business_date) VALUES (?,?,250,?,?)',[id,ctx.userId,when,date]);
  }else if(body.scenario==='meal'){
    table='meals';type='meal_confirmed';await tx.execute("INSERT INTO meals (id,user_id,meal_type,recorded_at,business_date,source) VALUES (?,?,'lunch',?,?,'manual')",[id,ctx.userId,when,date]);
    await tx.execute("INSERT INTO meal_items (id,meal_id,name,grams,calories_kcal,nutrition_source,sort_order) VALUES (?,?,'TEST_ONLY 独立测试餐',100,100,'user',0)",[randomUUID(),id]);
  }else{
    requireValue(body.courseKey==='course_a'||body.courseKey==='course_b',422,'INVALID_COURSE','请选择固定测试课程 A / B');
    const courseId=body.courseKey==='course_a'?'c0000000-0000-4000-8000-000000000001':'c0000000-0000-4000-8000-000000000003';
    await tx.execute("INSERT INTO training_courses (id,title,category,level,description,estimated_duration_seconds,estimated_calories_kcal,status) VALUES (?,?,'stretch','beginner','TEST_ONLY 无视频，仅验证 M05 来源契约',600,60,'draft') ON DUPLICATE KEY UPDATE id=id",[courseId,`TEST_ONLY ${body.courseKey}`]);
    const seconds=body.scenario==='workout_short'?300:480;table='workout_sessions';type='workout_completed';
    await tx.execute("INSERT INTO workout_sessions (id,user_id,course_id,status,started_at,ended_at,business_date,duration_snapshot_seconds,calories_snapshot_kcal,reward_threshold_seconds,active_duration_seconds,accumulated_seconds,estimated_calories_kcal,reward_eligible) VALUES (?,?,?,'completed',?,?,?,600,60,480,?,?,?,?)",[id,ctx.userId,courseId,new Date(when.getTime()-seconds*1000),when,date,seconds,seconds,seconds/10,seconds>=480]);
  }
  fail('after_source');const result=await points.awardInTransaction(tx,ctx,{type,sourceId:id});
  await audit.record(tx,ctx,'dev.points.source',table,id,{testOnly:true,scenario:body.scenario,date});
  return {sourceId:id,sourceType:table,testOnly:true,...result};
}
