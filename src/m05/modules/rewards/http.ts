import type {MediaPort} from '../../../../contracts/shared';
import {withMedia} from '../media/service';
import {Controller,Get,Post,Patch,Put,Req,Res,Param} from '@nestjs/common';
import type {Request,Response} from 'express';
import type {SqlTx,CommandContext} from '../../../../contracts/shared';
import {Config} from '../../common/config';
import {MysqlUnitOfWork} from '../../common/database';
import {Idempotency} from '../../common/idempotency';
import {IdentityPort,DevelopmentIdentity,safeEqual} from '../../common/identity';
import {exactBody,requireValue} from '../../common/errors';
import {queryKeys,uuid} from '../activities/model';
import {redemption} from './model';
import {RewardsService} from './service';
import {RewardsQueries} from './queries';
import {RedemptionWorker} from './worker';
import {DevelopmentRewardProvider} from './provider';
export function rewardsControllers(config:Config,identity:IdentityPort,dev:DevelopmentIdentity|null,uow:MysqlUnitOfWork,commands:Idempotency,service:RewardsService,worker:RedemptionWorker,send:(res:Response,data:unknown,status?:number)=>unknown,media?:MediaPort){
 const queries=new RewardsQueries(config.sessionSecret,service);
 async function auth(req:Request,admin=false,write=false){const i=await identity.resolve(req);if(admin)requireValue(i.roles.includes('admin'),403,'ADMIN_REQUIRED','需要管理员权限');if(write){requireValue(req.headers.origin===config.origin,403,'ORIGIN_FORBIDDEN','写入请求来源不匹配');requireValue(safeEqual(String(req.headers['x-csrf-token']||''),i.csrfToken),403,'CSRF_INVALID','CSRF 校验未通过');}return i;}
 async function write(req:Request,res:Response,admin:boolean,fn:(tx:SqlTx,ctx:CommandContext)=>Promise<unknown>,status=200,refs:string[]=[]){const i=await auth(req,admin,true);queryKeys(req.query,[]);const r=await commands.run(i.id,req.method,req.path,String(req.headers['idempotency-key']||''),req.body??{},async(tx,ctx)=>{if(admin)await service.admin(tx,ctx.userId);return {status,body:await fn(tx,ctx)};},refs);return send(res,r.body,r.status);}
 @Controller('api/v1') class Public {
  @Get('points/rewards') async list(@Req() req:Request,@Res() res:Response){return send(res,await withMedia(await uow.readSnapshot(tx=>queries.rewards(tx,req.query)),media));}
  @Get('me/points/redemptions') async orders(@Req() req:Request,@Res() res:Response){const i=await auth(req);return send(res,await uow.readSnapshot(tx=>queries.orders(tx,i.id,req.query)));}
  @Get('me/points/redemptions/:id') async detail(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req);queryKeys(req.query,[]);return send(res,await uow.readSnapshot(tx=>queries.detail(tx,id,i.id)));}
  @Post('me/points/redemptions') redeem(@Req() req:Request,@Res() res:Response){return write(req,res,false,(tx,ctx)=>service.redeem(tx,ctx,req.body),201);}
 }
 @Controller('api/v1/admin/points') class Admin {
  @Get('rewards') async list(@Req() req:Request,@Res() res:Response){const i=await auth(req,true);return send(res,await withMedia(await uow.readSnapshot(tx=>queries.rewards(tx,req.query,i.id)),media,i.id));}
  @Get('rewards/:id') async detail(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req,true);queryKeys(req.query,[]);return send(res,await withMedia(await uow.readSnapshot(tx=>queries.reward(tx,id)),media,i.id));}
  @Post('rewards') create(@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.save(tx,ctx,req.body),201);}
  @Patch('rewards/:id') save(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.save(tx,ctx,req.body,uuid(id)));}
  @Post('rewards/:id/publish') publish(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.lifecycle(tx,ctx,uuid(id),req.body));}
  @Post('rewards/:id/archive') archive(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.lifecycle(tx,ctx,uuid(id),req.body,true));}
  @Get('redemptions') async orders(@Req() req:Request,@Res() res:Response){const i=await auth(req,true);return send(res,await uow.readSnapshot(tx=>queries.orders(tx,i.id,req.query,true)));}
  @Get('redemptions/:id') async order(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req,true);queryKeys(req.query,[]);return send(res,await uow.readSnapshot(tx=>queries.detail(tx,id,i.id,true)));}
  @Post('redemptions/:id/reconcile') async reconcile(@Param('id') id:string,@Req() req:Request,@Res() res:Response){await auth(req,true,true);const r=await uow.readSnapshot(tx=>redemption(tx,id));return write(req,res,true,(tx,ctx)=>service.scheduleReconcile(tx,ctx,id,req.body),202,[r.user_id]);}
 }
 @Controller('api/dev') class Dev {
  @Get('provider') async config(@Req() req:Request,@Res() res:Response){dev!.authorizeDev(req);await auth(req,true);queryKeys(req.query,[]);return send(res,{mode:service.provider.mode,enabled:service.provider instanceof DevelopmentRewardProvider,scenario:service.provider instanceof DevelopmentRewardProvider?service.provider.scenario():null});}
  @Put('provider') async change(@Req() req:Request,@Res() res:Response){dev!.authorizeDev(req);await auth(req,true,true);queryKeys(req.query,[]);exactBody(req.body,['scenario']);requireValue(service.provider instanceof DevelopmentRewardProvider,503,'TEST_PROVIDER_DISABLED','测试供应商未开启');return send(res,service.provider.configure(req.body.scenario));}
  @Post('redemption-worker') async run(@Req() req:Request,@Res() res:Response){dev!.authorizeDev(req);await auth(req,true,true);queryKeys(req.query,[]);exactBody(req.body??{},[]);return send(res,await worker.tick());}
 }
 return config.audience==='h5'?[Public]:[Admin,...(config.devIdentity?[Dev]:[])];
}
