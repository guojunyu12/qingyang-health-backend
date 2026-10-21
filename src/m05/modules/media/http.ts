import {Controller,Get,Post,Put,Req,Res,Param} from '@nestjs/common';
import type {Request,Response} from 'express';
import {Config} from '../../common/config';
import {IdentityPort,safeEqual} from '../../common/identity';
import {Idempotency} from '../../common/idempotency';
import {queryKeys} from '../activities/model';
import {requireValue} from '../../common/errors';
import {LocalMedia} from './service';
export function mediaControllers(config:Config,identity:IdentityPort,commands:Idempotency,media:LocalMedia,send:(res:Response,data:unknown,status?:number)=>unknown){
 async function auth(req:Request,write=false){const i=await identity.resolve(req);requireValue(i.roles.includes('admin'),403,'ADMIN_REQUIRED','仅管理员可管理运营素材');if(write){requireValue(req.headers.origin===config.origin,403,'ORIGIN_FORBIDDEN','写入来源不匹配');requireValue(safeEqual(String(req.headers['x-csrf-token']||''),i.csrfToken),403,'CSRF_INVALID','CSRF 校验未通过');}return i;}
 @Controller('api/v1') class Read {
  @Get('uploads/:id/content') async content(@Param('id') id:string,@Req() req:Request,@Res() res:Response){queryKeys(req.query,['token']);let actor:string|null=null;try{actor=(await identity.resolve(req)).id;}catch{}const bytes=await media.content(id,req.query.token,actor);res.setHeader('Content-Type','image/webp');res.setHeader('Content-Disposition','inline');return res.send(bytes);}
 }
 @Controller('api/v1') class Admin {
  @Post('uploads/presign') async request(@Req() req:Request,@Res() res:Response){const i=await auth(req,true);queryKeys(req.query,[]);const r=await commands.run(i.id,req.method,req.path,String(req.headers['idempotency-key']||''),req.body,async(tx,ctx)=>({status:201,body:await media.presign(tx,ctx,req.body)}));return send(res,r.body,r.status);}
  @Put('uploads/:id/content') async upload(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req,true);queryKeys(req.query,['token']);return send(res,await media.upload(id,req.query.token,i.id,req.body,String(req.headers['content-type']||'')));}
  @Post('uploads/:id/complete') async complete(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req,true);queryKeys(req.query,[]);const r=await commands.run(i.id,req.method,req.path,String(req.headers['idempotency-key']||''),req.body,async(tx,ctx)=>({status:202,body:await media.complete(tx,ctx,id,req.body)}));return send(res,r.body,r.status);}
  @Get('uploads/:id') async info(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const i=await auth(req);queryKeys(req.query,[]);return send(res,await media.info(id,i.id));}
  @Get('admin/media-assets') async list(@Req() req:Request,@Res() res:Response){const i=await auth(req);return send(res,await media.list(i.id,req.query));}
 }
 return config.audience==='h5'?[Read]:[Read,Admin];
}
