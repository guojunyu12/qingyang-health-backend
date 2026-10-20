import test from 'node:test';
import assert from 'node:assert/strict';
import { QianwenVision, visionConfig } from '../src/modules/nutrition/qianwen-vision.js';

const config = { apiKey:'test-secret', model:'qwen3-vl-plus', baseUrl:'https://maas.qianwenaiapi.com/compatible-mode/v1', timeoutMs:60000 };
const item = { name:'米饭', grams:100, caloriesKcal:130, carbsG:28.2, proteinG:2.7, fatG:null };
const input = () => ({readUrl:'private-signed-image',requestKey:'job',signal:new AbortController().signal});
test('online vision sends controlled image bytes, bearer auth and model; normalizes candidates', async () => {
 let calls=0;
 const vision=new QianwenVision(config,async()=>Buffer.from('webp'),async(url,init)=>{
  calls++; assert.equal(String(url),config.baseUrl+'/chat/completions');
  assert.equal(init?.redirect,'error'); assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-secret');
  const body=JSON.parse(String(init?.body)); assert.equal(body.model,config.model);
  assert.equal(body.messages[0].content[0].image_url.url,'data:image/webp;base64,d2VicA==');
  assert.ok(!JSON.stringify(body).includes('private-signed-image'));
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[item]})}}]});
 });
 assert.deepEqual(await vision.recognize(input()),{items:[{...item,candidateIndex:0,foodId:null,nutritionSource:'model',confidence:null}]});
 assert.equal(calls,1);
});
test('supplier failures are private and never retried; malformed/truncated output rejected', async()=>{
 for(const result of [Response.json({error:{message:'test-secret'}},{status:401}),Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]}),Response.json({choices:[{finish_reason:'stop',message:{content:'bad JSON'}}]})]){
  let calls=0;const vision=new QianwenVision(config,async()=>Buffer.from('webp'),async()=>{calls++;return result});
  await assert.rejects(vision.recognize(input()),e=>e instanceof Error&&!e.message.includes('test-secret'));
  assert.equal(calls,1);
 }
});
test('online configuration rejects local/foreign endpoints and missing key disables vision',()=>{
 assert.equal(visionConfig({}),null);
 assert.equal(visionConfig({DASHSCOPE_API_KEY:'key'})?.model,'qwen3-vl-plus');
 for(const baseUrl of ['http://127.0.0.1:11434','https://attacker.example/v1','https://user:password@maas.qianwenaiapi.com/compatible-mode/v1'])
  assert.throws(()=>new QianwenVision({...config,baseUrl},async()=>Buffer.alloc(1)));
 assert.throws(()=>visionConfig({DASHSCOPE_API_KEY:'key',M03_VISION_PROVIDER:'ollama-local'}));
});
test('cancel before image read does not send a paid request',async()=>{
 let calls=0;const signal=AbortSignal.abort();
 const vision=new QianwenVision(config,async()=>Buffer.alloc(1),async()=>{calls++;throw Error('unexpected')});
 await assert.rejects(vision.recognize({...input(),signal})); assert.equal(calls,0);
});
