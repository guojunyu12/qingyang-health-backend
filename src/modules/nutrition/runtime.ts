import { env, origin } from '../../common/config.js';
import { mediaPort, modulePorts, outboxPort, unitOfWorkPort } from '../../common/ports.js';
import { MediaService } from '../uploads/service.js';
import { CursorCodec } from './domain.js';
import { NutritionService } from './nutrition.service.js';
import { QianwenVision, visionConfig } from './qianwen-vision.js';
import { RecognitionWorker, type VisionPort } from './recognition.worker.js';
import { RestaurantsService, type PoiPort } from '../restaurants/restaurants.service.js';
import { AmapMcpPoi } from '../restaurants/amap-mcp.js';

const cursors=new CursorCodec(env('AUTH_HMAC_KEY'));
export const nutritionService=new NutritionService({media:mediaPort,outbox:outboxPort,cursors,get points(){return modulePorts.points}});
// Incremental registration preserves all existing M01/M02 and future module ports.
modulePorts.nutrition=nutritionService;
const media=new MediaService();
export async function readRecognitionImage(readUrl:string,signal:AbortSignal) {
  signal.throwIfAborted();
  const url=new URL(readUrl);
  const match=/^\/api\/v1\/uploads\/read\/([a-f0-9-]+)$/.exec(url.pathname);
  if(url.origin!==new URL(origin).origin||!match)throw Error('Invalid controlled media URL');
  media.signed(match[1],'get',url.searchParams.get('expires')??'',url.searchParams.get('signature')??'');
  const bytes=await media.read(match[1]);signal.throwIfAborted();return bytes;
}
const config=visionConfig(process.env);
const amapKey=process.env.M03_AMAP_API_KEY?.trim();
export const nutritionRuntime:{vision:VisionPort|null;poi:PoiPort|null}={vision:config?new QianwenVision(config,readRecognitionImage):null,poi:amapKey?new AmapMcpPoi(amapKey):null};
export const restaurantsService=()=>new RestaurantsService(cursors,nutritionRuntime.poi);
export function recognitionWorker() {
  return nutritionRuntime.vision?new RecognitionWorker(unitOfWorkPort,mediaPort,nutritionService,nutritionRuntime.vision):null;
}
export async function nutritionCapabilities() {
  let poi=Boolean(nutritionRuntime.poi);
  if(nutritionRuntime.poi instanceof AmapMcpPoi && !nutritionRuntime.poi.isReady()){
    try{await nutritionRuntime.poi.initialize();}catch{poi=false;}
  }
  return {mode:'integrated' as const,upload:true,recognition:Boolean(nutritionRuntime.vision),poi,poiProvider:nutritionRuntime.poi?.provider??null,poiFavorites:poi && (nutritionRuntime.poi?.cacheTtlSeconds??0)>0,points:Boolean(modulePorts.points),dashboard:true};
}
