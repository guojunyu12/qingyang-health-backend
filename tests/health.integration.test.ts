import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IdentityService } from '../src/modules/identity/service.js';
import { pool } from '../src/common/database.js';
import { modulePorts } from '../src/common/ports.js';
import { redis } from '../src/modules/identity/limiter.js';
const integration = process.env.DB_NAME?.endsWith('_test') ? test : test.skip;
integration('M02 real auth/CSRF, profile versions, water idempotency/isolation, weight and aggregates', async () => {
 process.env.AUTH_NO_LISTEN='1'; const {createApp}=await import('../src/main.js');
 let code=''; const identity=new IdentityService(async (_email,c)=>{code=c});
 const app=await createApp(identity); await app.listen(0,'127.0.0.1');
 const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
 let cookies='',csrf='';
 const request=(path:string,method='GET',body?:unknown,key=randomUUID(),token=csrf)=>fetch(base+path,{method,headers:{Origin:'http://127.0.0.1:3001',Cookie:cookies,'X-CSRF-Token':token,'Idempotency-Key':key,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const login=async()=>{
  const r=await request('/auth/email-codes','POST',{email:`health-${randomUUID()}@example.com`,purpose:'login'}); assert.equal(r.status,200);
  const challenge=(await r.json()).data;
  const auth=await request('/auth/login','POST',{challengeId:challenge.challengeId,code,deviceId:randomUUID(),platform:'h5'});assert.equal(auth.status,200);
  cookies=auth.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  csrf=(await (await request('/auth/csrf')).json()).data.csrfToken;
 };
 try {
  assert.equal((await request('/me/dashboard')).status,401);
  await login();
  assert.equal((await request('/me/water-records','POST',{amountMl:250},randomUUID(),'')).status,403);
  let r=await request('/me/dashboard'); assert.equal(r.status,200); let d=(await r.json()).data;
  assert.equal(d.water.totalMl,0);assert.equal(d.energy.intakeKcal,null);assert.equal(d.energy.exerciseKcal,null);assert.equal(d.availability.points,false); assert.equal(d.pointsBalance,null);
  const profile={version:0,targetWeightKg:60,waterTargetMl:2000,calorieTargetKcal:1800,goalType:'balanced'};
  r=await request('/me/health-profile','PUT',profile); assert.equal(r.status,200); assert.equal((await r.json()).data.version,1);
  assert.equal((await request('/me/health-profile','PUT',profile)).status,409);
  const key=randomUUID();r=await request('/me/water-records','POST',{amountMl:250},key); assert.equal(r.status,201);d=(await r.json()).data; const id=d.record.id;
  assert.equal(d.rewardsAvailable,false);assert.deepEqual(d.awards,[]);
  assert.equal((await (await request('/me/water-records','POST',{amountMl:250},key)).json()).data.record.id,id);
  assert.equal((await request('/me/water-records','POST',{amountMl:300},key)).status,409);
  await request('/me/water-records','POST',{amountMl:250});
  r=await request('/me/dashboard');d=(await r.json()).data;assert.equal(d.water.totalMl,500);
  r=await request('/me/weight-records','POST',{weightKg:68.2});assert.equal(r.status,201);const weight=(await r.json()).data;
  r=await request('/me/health/overview?range=30');assert.equal(r.status,200);d=(await r.json()).data;assert.equal(d.series.length,30);assert.equal(d.summary.latestWeightKg,68.2);
  assert.equal((await request(`/me/weight-records/${weight.id}`,'DELETE')).status,204);
  r=await request(`/me/water-records/${id}`,'DELETE');assert.equal(r.status,204);
  assert.equal((await request('/me/water-records','POST',{amountMl:1001})).status,422);
  assert.equal((await request('/me/weight-records','POST',{weightKg:10})).status,422);
  modulePorts.points = { ensureAccountInTransaction:async()=>{throw Error('unavailable')}, awardInTransaction:async()=>{throw Error('points transaction failed')} };
  try {
   assert.equal((await request('/me/water-records','POST',{amountMl:100})).status,500);
   assert.equal((await (await request('/me/dashboard')).json()).data.water.totalMl,250);
   const yesterday=new Date(Date.now()+8*3600000-86400000).toISOString().slice(0,10);
   assert.equal((await request('/me/water-records','POST',{amountMl:100,recordedAt:yesterday+'T12:00:00+08:00'})).status,201);
  } finally { delete modulePorts.points; }
  for(let i=0;i<5;i++) assert.equal((await request('/me/water-records','POST',{amountMl:1000})).status,201);
  assert.equal((await request('/me/water-records','POST',{amountMl:500})).status,201);
  const concurrent=await Promise.all([request('/me/water-records','POST',{amountMl:250}),request('/me/water-records','POST',{amountMl:250})]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(),[201,409]);
  const firstCookies=cookies,firstCsrf=csrf;
  await login();assert.equal((await (await request('/me/dashboard')).json()).data.water.totalMl,0);
  assert.equal((await request(`/me/water-records/${id}`,'DELETE')).status,404);
  cookies=firstCookies;csrf=firstCsrf;
  assert.equal((await (await request('/me/dashboard')).json()).data.water.totalMl,6000);
 } finally {await app.close();}
});
after(async()=>{await pool.end();if(redis.isOpen) await redis.quit()});
