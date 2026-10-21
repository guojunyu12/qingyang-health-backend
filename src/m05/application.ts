import express from 'express';
import type {NotificationsPort} from '../../contracts/phase-06-extensions';
import {MessagesService,LocalNotifications} from './modules/notifications/service';
import {NotificationsWorker} from './modules/notifications/worker';
import {NotificationFailures} from './modules/notifications/dev';
import {messageControllers} from './modules/notifications/http';
import {LocalMedia} from './modules/media/service';
import {mediaControllers} from './modules/media/http';
import 'reflect-metadata';
import {CodeVault,DevelopmentRewardProvider,UnavailableProvider,type RewardProvider} from './modules/rewards/provider';
import {RewardsService} from './modules/rewards/service';
import {RedemptionWorker} from './modules/rewards/worker';
import {rewardsControllers} from './modules/rewards/http';
import {Controller,Get,Post,Delete,Req,Res,Module,Catch,ExceptionFilter,ArgumentsHost,HttpException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {Request,Response,NextFunction} from 'express';
import {randomUUID} from 'node:crypto';
import {Config} from './common/config';
import {Database,MysqlUnitOfWork,BASELINE_SHA,requestContext,Clock} from './common/database';
import {Idempotency} from './common/idempotency';
import {DevelopmentIdentity,UnconfiguredM01Identity,IdentityPort,FIXTURES} from './common/identity';
import {DomainError,exactBody,requireValue} from './common/errors';
import {pointsControllers} from './modules/points/http';
import {DevelopmentClock} from './modules/points/dev';
import type {MediaPort,UserAdministrationPort} from '../../contracts/shared';
import {ActivitiesService} from './modules/activities/service';
import {CommunityService} from './modules/activities/community';
import {activityControllers} from './modules/activities/http';
import {ActivitySettlementWorker} from './modules/activities/worker';
import {LocalUserAdministration} from './common/ports';
export async function createApplication(config:Config,adapters:{identity?:IdentityPort;clock?:Clock;media?:MediaPort;users?:UserAdministrationPort;startWorkers?:boolean;rewardProvider?:RewardProvider;codeKey?:string;notifications?:NotificationsPort;enablePhase6?:boolean}={}) {
  if(config.production&&adapters.notifications?.mode==='local_in_app')throw new Error('PRODUCTION_LOCAL_NOTIFICATIONS_FORBIDDEN');
  if(config.production&&adapters.media instanceof LocalMedia)throw new Error('PRODUCTION_LOCAL_MEDIA_FORBIDDEN');
  if(config.production && config.devIdentity) throw new Error('PRODUCTION_DEV_IDENTITY_FORBIDDEN');
  if(config.production && config.devClock) throw new Error('PRODUCTION_DEV_CLOCK_FORBIDDEN');
  if(config.production&&config.devRewards)throw new Error('PRODUCTION_DEV_REWARDS_FORBIDDEN');
  if(config.production&&adapters.rewardProvider?.mode==='development')throw new Error('PRODUCTION_DEV_PROVIDER_FORBIDDEN');
  const vault=new CodeVault(adapters.codeKey||config.rewardCodeKey);
  const provider=adapters.rewardProvider||(config.devIdentity&&config.devRewards?new DevelopmentRewardProvider(config.db.database,vault):new UnavailableProvider());
  if(provider.mode!=='unavailable'&&!vault.ready)throw new Error('REWARD_CODE_KEY_REQUIRED');
  const db=new Database(config.db),uow=new MysqlUnitOfWork(db,adapters.clock||(config.devIdentity&&config.devClock?new DevelopmentClock(config.db.database):new Clock())),commands=new Idempotency(uow);
  const phase6Ready=adapters.enablePhase6!==false&&(await db.query("SELECT version FROM schema_migrations WHERE version='V002_M05'")).length>0;
  const localMedia=phase6Ready&&config.devIdentity&&!adapters.media?new LocalMedia(uow,config.sessionSecret,config.db.database):null;
  const media=adapters.media||localMedia||undefined;
  const notificationFailures=phase6Ready&&config.devIdentity?new NotificationFailures(config.db.database):null;
  const messages=new MessagesService(config.sessionSecret,adapters.notifications||(notificationFailures?new LocalNotifications(id=>notificationFailures.assert(id)):null));
  const notificationsWorker=new NotificationsWorker(uow,messages);
  const dev=config.devIdentity?new DevelopmentIdentity(config,db,uow,commands):null;
  const identity:IdentityPort=adapters.identity || dev || new UnconfiguredM01Identity();
  const activities=new ActivitiesService(media),community=new CommunityService(config.sessionSecret,activities,adapters.users||(config.devIdentity?new LocalUserAdministration():{async disableInTransaction(){throw new DomainError(503,'USER_ADMIN_NOT_CONFIGURED','M01 用户管理端口尚未接入');}})),settlement=new ActivitySettlementWorker(uow,activities);
  const rewards=new RewardsService(provider,vault,media),redemptionWorker=new RedemptionWorker(uow,rewards);
  const meta=(res:Response)=>({requestId:res.locals.requestId,serverTime:new Date().toISOString(),timezone:'Asia/Shanghai'});
  const send=(res:Response,data:unknown,status=200)=>res.status(status).json({data,meta:meta(res)});
  @Catch()
  class Errors implements ExceptionFilter {
    catch(error:unknown,host:ArgumentsHost){
      const res=host.switchToHttp().getResponse<Response>();
      let status=500,code='INTERNAL_ERROR',message='服务暂时不可用';
      if(error instanceof DomainError){status=error.status;code=error.code;message=error.message;}
      else if(error instanceof HttpException){status=error.getStatus();code=status===404?'NOT_FOUND':'INVALID_REQUEST';message=status===404?'接口不存在':'请求格式错误';}
      else if((error as {type?:string})?.type==='entity.too.large'){status=413;code='UPLOAD_TOO_LARGE';message='Upload exceeds size limit';}
      else if((error as {type?:string})?.type==='entity.parse.failed'){status=422;code='INVALID_JSON';message='JSON 格式错误';}
      if(status>=500) console.error(JSON.stringify({requestId:res.locals.requestId,code:(error as {code?:string})?.code || 'INTERNAL_ERROR'}));
      res.status(status).json({error:{code,message},meta:meta(res)});
    }
  }
  async function contract() {
    const rows=await db.query<{version:string;checksum_sha256:string}>('SELECT version,checksum_sha256 FROM schema_migrations ORDER BY version');
    requireValue(rows.some(r=>r.version==='V001'&&r.checksum_sha256===BASELINE_SHA),503,'SCHEMA_MISMATCH','数据库基线尚未正确初始化');
    return {contractVersion:'QY-MYSQL-1.0.0',schemaVersion:rows.at(-1)!.version,baselineSha256:rows.find(r=>r.version==='V001')!.checksum_sha256,timezone:'Asia/Shanghai',migrations:rows.map(r=>r.version),identityAdapter:config.devIdentity?'development':'m01_external',audience:config.audience};
  }
  @Controller()
  class CommonController {
    @Get('api/status') status(@Res() res:Response){return send(res,{service:config.audience,phase:7,developmentIdentityEnabled:config.devIdentity});}
    @Get('api/v1/health') async health(@Res() res:Response){
      await db.query('SELECT 1 AS ok');await contract();return send(res,{status:'ready',database:'connected',service:config.audience});
    }
    @Get('api/v1/me') async me(@Req() req:Request,@Res() res:Response){
      const i=await identity.resolve(req);return send(res,{id:i.id,nickname:i.nickname,avatarUrl:null,roles:i.roles,csrfToken:i.csrfToken,identityMode:config.devIdentity?'development':'external'});
    }
    @Get('api/v1/meta/contract') async getContract(@Req() req:Request,@Res() res:Response){await identity.resolve(req);return send(res,await contract());}
  }
  @Controller('api/dev')
  class DevelopmentController {
    @Post('session') async login(@Req() req:Request,@Res() res:Response){
      dev!.authorizeDev(req);exactBody(req.body,['profileKey']);requireValue(typeof req.body.profileKey==='string' && Object.hasOwn(FIXTURES,req.body.profileKey),422,'INVALID_PROFILE','请选择固定测试身份');
      const result=await dev!.login(req,res,req.body.profileKey);return send(res,result.body,result.status);
    }
    @Delete('session') async logout(@Req() req:Request,@Res() res:Response){await dev!.logout(req,res);return res.status(204).end();}
  }
  @Controller('api/v1/admin')
  class AdminController {
    @Get('overview') async overview(@Req() req:Request,@Res() res:Response){
      const i=await identity.resolve(req);requireValue(i.roles.includes('admin'),403,'ADMIN_REQUIRED','此页面需要管理员身份');
      return send(res,await uow.readSnapshot(async tx=>{
        const [counts]=await tx.query<{
          totalAvailablePoints:number;publishedActivities:number;confirmedBookings:number;publishedRewards:number;
          pendingRedemptions:number;openReports:number;sentCampaigns:number;unreadNotifications:number;
        }>(`SELECT
          (SELECT COALESCE(SUM(balance),0) FROM point_accounts) totalAvailablePoints,
          (SELECT COUNT(*) FROM activities WHERE status='published') publishedActivities,
          (SELECT COUNT(*) FROM activity_bookings WHERE status='confirmed') confirmedBookings,
          (SELECT COUNT(*) FROM point_rewards WHERE status='published') publishedRewards,
          (SELECT COUNT(*) FROM point_redemptions WHERE status='pending') pendingRedemptions,
          (SELECT COUNT(*) FROM community_reports WHERE status='pending') openReports,
          (SELECT COUNT(*) FROM m05_message_campaigns WHERE status IN ('queued','sending','completed','partial_failed')) sentCampaigns,
          (SELECT COUNT(*) FROM notifications WHERE read_at IS NULL) unreadNotifications`,[]);
        return Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,Number(value)]));
      }));
    }
    @Get('runtime') async runtime(@Req() req:Request,@Res() res:Response){
      const i=await identity.resolve(req);requireValue(i.roles.includes('admin'),403,'ADMIN_REQUIRED','此页面需要管理员身份');
      const [version]=await db.query<{version:string;timezone:string;isolation:string}>('SELECT VERSION() AS version,@@session.time_zone AS timezone,@@session.transaction_isolation AS isolation');
      const [count]=await db.query<{total:number}>("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND table_name<>'schema_migrations'");
      const [users]=await db.query<{total:number}>("SELECT COUNT(*) AS total FROM users WHERE status='active'");
      const [sessions]=await db.query<{total:number}>('SELECT COUNT(*) AS total FROM user_sessions WHERE revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3)');
      return send(res,{...await contract(),mysqlVersion:version.version,connectionTimezone:version.timezone,transactionIsolation:'READ COMMITTED',businessTableCount:Number(count.total),activeUserCount:Number(users.total),activeSessionCount:Number(sessions.total),sharedDatabase:true,implemented:['账号摘要','开发会话','CSRF 与后台权限','统一事务与幂等','Outbox / 审计写入端口','积分账户、任务、流水与规则管理','活动、预约、社区与审核','权益目录、兑换账务与履约核对','通知收件箱、运营消息、素材与审计'],pending:['真实权益供应商接入验收','真实外部推送接入验收']});
    }
  }
  @Module({controllers:[CommonController,...(phase6Ready?messageControllers(config,identity,dev,uow,commands,messages,notificationsWorker,notificationFailures,send):[]),...(localMedia?mediaControllers(config,identity,commands,localMedia,send):[]),...rewardsControllers(config,identity,dev,uow,commands,rewards,redemptionWorker,send,media),...activityControllers(config,identity,dev,uow,commands,activities,community,send,media),...pointsControllers(config,identity,dev,uow,commands,send),...(config.devIdentity?[DevelopmentController]:[]),...(config.audience==='admin'?[AdminController]:[])]})
  class AppModule {}
  const app=await NestFactory.create(AppModule,{logger:['error','warn']});
  app.use('/api/v1/uploads/:id/content',express.raw({type:()=>true,limit:5*1024*1024}));
  app.use((req:Request,res:Response,next:NextFunction)=>{
    res.locals.requestId=randomUUID();res.setHeader('X-Request-Id',res.locals.requestId);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');requestContext.run({requestId:res.locals.requestId},next);
  });
  app.useGlobalFilters(new Errors());
  await app.init();
  if(config.audience==='admin'&&adapters.startWorkers!==false){settlement.start();redemptionWorker.start();if(phase6Ready){notificationsWorker.start();localMedia?.start();}}
  return {app,db,uow,commands,identity,activities,community,settlement,rewards,redemptionWorker,messages,notificationsWorker,localMedia,notificationFailures,close:async()=>{await notificationsWorker.stop();await localMedia?.stop();await redemptionWorker.stop();await settlement.stop();await app.close();await db.close();}};
}
