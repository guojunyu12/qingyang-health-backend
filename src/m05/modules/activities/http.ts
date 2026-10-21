import type {MediaPort} from '../../../../contracts/shared';
import {withMedia} from '../media/service';
import {Controller,Get,Post,Patch,Put,Delete,Req,Res,Param} from '@nestjs/common';
import type {Request,Response} from 'express';
import type {SqlTx,CommandContext} from '../../../../contracts/shared';
import {Config} from '../../common/config';
import {MysqlUnitOfWork} from '../../common/database';
import {Idempotency} from '../../common/idempotency';
import {IdentityPort,DevelopmentIdentity,safeEqual} from '../../common/identity';
import {exactBody,requireValue} from '../../common/errors';
import {ActivitiesService} from './service';
import {ActivitiesQueries} from './queries';
import {CommunityService} from './community';
import {queryKeys,slot,uuid} from './model';
export function activityControllers(config:Config,identity:IdentityPort,dev:DevelopmentIdentity|null,uow:MysqlUnitOfWork,commands:Idempotency,service:ActivitiesService,community:CommunityService,send:(res:Response,data:unknown,status?:number)=>unknown,media?:MediaPort){
 const queries=new ActivitiesQueries(config.sessionSecret),now=()=>uow.clock.now();
 async function auth(req:Request,admin=false,write=false){const i=await identity.resolve(req);if(admin)requireValue(i.roles.includes('admin'),403,'ADMIN_REQUIRED','需要管理员权限');if(write){requireValue(req.headers.origin===config.origin,403,'ORIGIN_FORBIDDEN','写入请求来源不匹配');requireValue(safeEqual(String(req.headers['x-csrf-token']||''),i.csrfToken),403,'CSRF_INVALID','CSRF 校验未通过');}return i;}
 async function write(req:Request,res:Response,admin:boolean,fn:(tx:SqlTx,ctx:CommandContext)=>Promise<unknown>,status=200,refs:string[]=[]){const i=await auth(req,admin,true);queryKeys(req.query,[]);const r=await commands.run(i.id,req.method,req.path,String(req.headers['idempotency-key']||''),req.body??{},async(tx,ctx)=>{if(admin)await service.assertAdmin(tx,ctx.userId);return {status,body:await fn(tx,ctx)};},refs);return status===204?res.status(204).end():send(res,r.body,r.status);}
 @Controller('api/v1')
 class PublicController {
  @Get('activities') async list(@Req() req:Request,@Res() res:Response){return send(res,await withMedia(await uow.readSnapshot(tx=>queries.activities(tx,req.query,now())),media));}
  @Get('activities/:id') async detail(@Param('id') id:string,@Req() req:Request,@Res() res:Response){queryKeys(req.query,[]);return send(res,await withMedia(await uow.readSnapshot(tx=>queries.detail(tx,id,now())),media));}
  @Get('activities/:id/slots') async slots(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return send(res,await uow.readSnapshot(tx=>queries.slots(tx,id,req.query,now())));}
 }
 @Controller('api/v1')
 class PersonalController {
  @Get('activity-slots/:id/participants') async participants(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req);return send(res,await uow.readSnapshot(tx=>queries.participants(tx,id,i.id,req.query)));}
  @Get('me/bookings') async bookings(@Req() req:Request,@Res() res:Response){const i=await auth(req);return send(res,await uow.readSnapshot(tx=>queries.bookings(tx,i.id,req.query)));}
  @Get('me/bookings/:id') async booking(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req);queryKeys(req.query,[]);return send(res,await uow.readSnapshot(tx=>queries.bookingDetail(tx,id,i.id)));}
  @Post('me/bookings') book(@Req() req:Request,@Res() res:Response){return write(req,res,false,(tx,ctx)=>service.book(tx,ctx,req.body),201);}
  @Post('me/bookings/:id/cancel') cancel(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,false,(tx,ctx)=>service.cancelBooking(tx,ctx,uuid(id),req.body));}
  @Get('me/community-profile') async profile(@Req() req:Request,@Res() res:Response){const i=await auth(req);queryKeys(req.query,[]);return send(res,await uow.readSnapshot(tx=>community.profile(tx,i.id)));}
  @Put('me/community-profile') saveProfile(@Req() req:Request,@Res() res:Response){return write(req,res,false,(tx,ctx)=>community.saveProfile(tx,ctx,req.body));}
  @Get('community/users/:id') async user(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req);queryKeys(req.query,[]);return send(res,await uow.readSnapshot(tx=>community.publicProfile(tx,id,i.id)));}
  @Get('me/blocks') async blocks(@Req() req:Request,@Res() res:Response){const i=await auth(req);return send(res,await uow.readSnapshot(tx=>community.blocks(tx,i.id,req.query)));}
  @Put('me/blocks/:id') async block(@Param('id') id:string,@Req() req:Request,@Res() res:Response){await auth(req,false,true);uuid(id);exactBody(req.body??{},[]);return write(req,res,false,(tx,ctx)=>community.block(tx,ctx,id),200,[id]);}
  @Delete('me/blocks/:id') async unblock(@Param('id') id:string,@Req() req:Request,@Res() res:Response){await auth(req,false,true);uuid(id);exactBody(req.body??{},[]);return write(req,res,false,(tx,ctx)=>community.block(tx,ctx,id,true),204,[id]);}
  @Post('community/reports') report(@Req() req:Request,@Res() res:Response){return write(req,res,false,(tx,ctx)=>community.report(tx,ctx,req.body),201);}
 }
 @Controller('api/v1/admin')
 class AdminActivitiesController {
  @Get('activities') async list(@Req() req:Request,@Res() res:Response){const i=await auth(req,true);return send(res,await withMedia(await uow.readSnapshot(tx=>queries.activities(tx,req.query,now(),i.id)),media,i.id));}
  @Get('activities/:id') async detail(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req,true);queryKeys(req.query,[]);return send(res,await withMedia(await uow.readSnapshot(tx=>queries.detail(tx,id,now(),true)),media,i.id));}
  @Post('activities') create(@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.saveActivity(tx,ctx,req.body),201);}
  @Patch('activities/:id') edit(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.saveActivity(tx,ctx,req.body,uuid(id)));}
  @Post('activities/:id/publish') publish(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.publish(tx,ctx,uuid(id),req.body));}
  @Post('activities/:id/archive') archive(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.archive(tx,ctx,uuid(id),req.body));}
  @Get('activities/:id/slots') async slots(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req,true);return send(res,await uow.readSnapshot(tx=>queries.slots(tx,id,req.query,now(),i.id)));}
  @Post('activities/:id/slots') createSlot(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.saveSlot(tx,ctx,uuid(id),req.body),201);}
  @Patch('activity-slots/:id') async editSlot(@Param('id') id:string,@Req() req:Request,@Res() res:Response){await auth(req,true,true);const located=await uow.readSnapshot(tx=>slot(tx,id));return write(req,res,true,(tx,ctx)=>service.saveSlot(tx,ctx,located.activity_id,req.body,id));}
  @Post('activity-slots/:id/cancel') cancelSlot(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.cancelSlot(tx,ctx,uuid(id),req.body));}
  @Get('bookings') async bookings(@Req() req:Request,@Res() res:Response){const i=await auth(req,true);return send(res,await uow.readSnapshot(tx=>queries.bookings(tx,i.id,req.query,true)));}
  @Post('bookings/:id/check-in') checkin(@Param('id') id:string,@Req() req:Request,@Res() res:Response){return write(req,res,true,(tx,ctx)=>service.checkin(tx,ctx,uuid(id),req.body));}
  @Get('community/reports') async reports(@Req() req:Request,@Res() res:Response){const i=await auth(req,true);return send(res,await uow.readSnapshot(tx=>community.reports(tx,i.id,req.query)));}
  @Post('community/reports/:id/resolve') async resolve(@Param('id') id:string,@Req() req:Request,@Res() res:Response){await auth(req,true,true);const located=await uow.readSnapshot(tx=>community.target(tx,id));return write(req,res,true,(tx,ctx)=>community.resolve(tx,ctx,id,req.body,located),200,located.target_type==='user'?[located.target_id]:[]);}
 }
 @Controller('api/dev')
 class DevelopmentActivitiesController {
  @Post('activity-settlement') settle(@Req() req:Request,@Res() res:Response){dev!.authorizeDev(req);exactBody(req.body??{},[]);return write(req,res,true,async(tx,ctx)=>{const due=await tx.query<{id:string}>("SELECT id FROM activity_slots WHERE status='open' AND end_at<? ORDER BY activity_id,id LIMIT 50",[new Date(ctx.operationNow)]);let noShow=0;for(const s of due)noShow+=await service.settle(tx,s.id,ctx.operationNow);return {settledSlots:due.length,noShow};});}
 }
 return config.audience==='h5'?[PublicController,PersonalController]:[AdminActivitiesController,...(config.devIdentity?[DevelopmentActivitiesController]:[])];
}
