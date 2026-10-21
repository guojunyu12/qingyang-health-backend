import {MysqlUnitOfWork} from '../../common/database';
import {ActivitiesService} from './service';
export class ActivitySettlementWorker {
 private timer:ReturnType<typeof setInterval>|null=null;private running:Promise<unknown>|null=null;
 constructor(private uow:MysqlUnitOfWork,private service:ActivitiesService){}
 async tick(){if(this.running)return this.running;this.running=(async()=>{const now=this.uow.clock.now(),due=await this.uow.db.query<{id:string}>("SELECT id FROM activity_slots WHERE status='open' AND end_at<? ORDER BY activity_id,id LIMIT 50",[new Date(now)]);for(const s of due)await this.uow.runSystem('provider_job',(tx,ctx)=>this.service.settle(tx,s.id,ctx.operationNow));return due.length;})();try{return await this.running;}finally{this.running=null;}}
 start(){this.timer=setInterval(()=>void this.tick().catch(e=>console.error(JSON.stringify({worker:'activity-settlement',code:e?.code||'SETTLEMENT_FAILED'}))),15000);this.timer.unref();}
 async stop(){if(this.timer)clearInterval(this.timer);await this.running?.catch(()=>{});}
}
