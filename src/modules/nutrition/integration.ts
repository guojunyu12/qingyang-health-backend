import type {Request,Response} from 'express';
import type {IdentityService} from '../identity/service.js';
import type {CommandContext,SqlTx} from '../../../contracts/shared_types.js';
import {equal} from '../identity/crypto.js';
import {idempotent} from '../../common/foundation.js';
import {ApiFailure,reject} from '../../common/error.js';
import {sqlTx,unitOfWorkPort} from '../../common/ports.js';
import {DomainError,keys} from './domain.js';
import {nutritionService as nutrition,nutritionRuntime,nutritionCapabilities,restaurantsService} from './runtime.js';

const supported=/^\/(?:foods|nutrition\/capabilities|me\/meals(?:\/[^/]+)?|me\/recognition-jobs(?:\/[^/]+(?:\/cancel)?)?|me\/restaurant-favorites(?:\/[^/]+)?|restaurants\/(?:nearby|[^/]+))$/;
export async function nutritionResources(req:Request,_res:Response,identity:IdentityService):Promise<{status:number;data?:unknown;raw?:boolean}|null>{
 if(!supported.test(req.path))return null;
 const session=await identity.session(req.cookies.qy_access??'');
 if(req.method!=='GET'&&!equal(String(req.headers['x-csrf-token']??''),identity.csrf(session.session_id)))reject(403,'INVALID_CSRF','安全校验失败，请刷新后重试');
 const query:Record<string,string>={};
 try{
  for(const [key,value]of Object.entries(req.query)){if(typeof value!=='string')throw new DomainError('INVALID_QUERY','查询参数格式不正确');query[key]=value;}
  const read=<T>(run:(tx:SqlTx)=>Promise<T>)=>unitOfWorkPort.readSnapshot(run);
  const command=<T>(status:number,run:(tx:SqlTx,ctx:CommandContext)=>Promise<T>)=>idempotent(session.id,req.method,req.path,req.headers['idempotency-key'],req.body??{},async(c,ctx)=>{
   try{return await run(sqlTx(c),ctx);}catch(e){if(e instanceof DomainError)throw new ApiFailure(e.status,e.code,e.message);throw e;}
  },status);
  const noQuery=()=>keys(query,[]);
  const noBody=()=>{noQuery();if(req.body && (typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw new DomainError('UNKNOWN_FIELD','这个请求无需正文');};
  const p=req.path,m=req.method,parts=p.split('/'),id=parts[3];
  if(p==='/nutrition/capabilities'&&m==='GET'){noQuery();return {status:200,data:await nutritionCapabilities()};}
  if(p==='/foods'&&m==='GET')return {status:200,data:await read(tx=>nutrition.foods(tx,query))};
  if(p==='/me/meals'&&m==='GET')return {status:200,data:await read(tx=>nutrition.list(tx,session.id,query))};
  if(p==='/me/meals'&&m==='POST'){noQuery();return {status:201,data:await command(201,(tx,ctx)=>nutrition.create(tx,ctx,req.body))};}
  if(parts[2]==='meals'&&id){
   noQuery();
   if(m==='GET')return {status:200,data:await nutrition.withPhoto(await read(tx=>nutrition.get(tx,session.id,id)),session.id)};
   if(m==='PATCH')return {status:200,data:await command(200,(tx,ctx)=>nutrition.update(tx,ctx,id,req.body))};
   if(m==='DELETE'){noBody();await command(204,(tx,ctx)=>nutrition.remove(tx,ctx,id));return {status:204};}
  }
  if(p==='/me/recognition-jobs'&&m==='POST'){
   noQuery();if(!nutritionRuntime.vision)reject(503,'RECOGNITION_NOT_CONFIGURED','线上识别尚未配置，请联系管理员');
   return {status:202,data:await command(202,(tx,ctx)=>nutrition.createJob(tx,ctx,req.body))};
  }
  if(parts[2]==='recognition-jobs'&&id){
   noQuery();
   if(parts.length===4&&m==='GET')return {status:200,data:await read(tx=>nutrition.job(tx,session.id,id))};
   if(parts[4]==='cancel'&&m==='POST'){noBody();return {status:200,data:await command(200,(tx,ctx)=>nutrition.cancelJob(tx,ctx,id))};}
  }
  const restaurants=restaurantsService();
  if(p==='/restaurants/nearby'&&m==='GET')return {status:200,data:await restaurants.search(session.id,query,read,fn=>unitOfWorkPort.runForUser(session.id,tx=>fn(tx)))};
  if(parts[1]==='restaurants'&&parts.length===3&&m==='GET')return {status:200,data:await read(tx=>restaurants.get(tx,session.id,parts[2],query))};
  if(p==='/me/restaurant-favorites'&&m==='GET')return {status:200,data:await read(tx=>restaurants.favorites(tx,session.id,query))};
  if(parts[2]==='restaurant-favorites'&&id&&(m==='PUT'||m==='DELETE')){
   noBody();
   if(m==='PUT'&&(!nutritionRuntime.poi||nutritionRuntime.poi.cacheTtlSeconds<=0))reject(503,'POI_CACHE_NOT_ALLOWED','当前地图服务尚未开放收藏');
   const status=m==='PUT'?200:204;return {status,data:await command(status,(tx,ctx)=>restaurants.favorite(tx,ctx,id,m==='PUT'))};
  }
  reject(404,'NOT_FOUND','接口不存在');
 }catch(e){if(e instanceof DomainError)throw new ApiFailure(e.status,e.code,e.message);throw e;}
}
