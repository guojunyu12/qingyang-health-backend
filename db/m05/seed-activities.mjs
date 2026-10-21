import mysql from 'mysql2/promise';
import {fileURLToPath} from 'node:url';
import {fixtures} from './seed.mjs';
export async function seedActivities(options){
 if(process.env.IDENTITY_MODE!=='development'||process.env.APP_ENV==='production'||process.env.NODE_ENV==='production')throw new Error('DEVELOPMENT_SEED_ONLY');
 const c=await mysql.createConnection({...options,timezone:'Z'});
 const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10),midnight=Date.parse(date+'T00:00:00+08:00');
 const samples=[['晨光散步 · 给生活一点留白','walking','轻养公园东门','独立测试地址 · 公园步道入口',9,12],['轻柔瑜伽 · 找回身体的舒展','yoga','轻养活动室','独立测试地址 · 活动中心二层',15,8],['好好吃饭 · 生活小课堂','workshop','轻养共享空间','独立测试地址 · 活动中心一层',19,6],['周末慢跑 · 筹备中','running','轻养公园南门','独立测试地址 · 南门集合点',10,10]];
 try{await c.query("SET SESSION time_zone = '+00:00'");await c.beginTransaction();let created=0;
 for(let i=0;i<samples.length;i++){
 const [title,category,location,address,hour,capacity]=samples[i],id=`c4000000-0000-4000-8000-00000000000${i+1}`;
 const [exists]=await c.execute('SELECT id FROM activities WHERE id=?',[id]);if(exists.length)continue;
 await c.execute('INSERT INTO activities (id,organizer_user_id,title,category,description,location_name,address,status) VALUES (?,?,?,?,?,?,?,?)',[id,fixtures.admin,title,category,'放慢一点，和轻养一起感受日常里的好状态。\n请提前 10 分钟到达集合点，穿着舒适衣物。\n本活动为 M05 独立验收演示内容，不对应真实线下活动。',location,address,i===3?'draft':'published']);created++;
 for(let j=0;j<2;j++){const start=midnight+(1+j*2)*86400000+hour*3600000;await c.execute('INSERT INTO activity_slots (id,activity_id,start_at,end_at,capacity,booking_open_at,booking_close_at,cancel_before_at) VALUES (?,?,?,?,?,?,?,?)',[`d4000000-0000-4000-8000-0000000000${i+1}${j+1}`,id,new Date(start),new Date(start+3600000),j===1&&i===0?1:capacity,new Date(midnight-86400000),new Date(start-3600000),new Date(start-2*3600000)]);}
 }
 await c.commit();return {createdActivities:created,existingContentUnchanged:true,createdBookings:0,createdCommunityProfiles:0};
 }catch(e){await c.rollback();throw e;}finally{await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){process.loadEnvFile('.env');console.log(await seedActivities({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}));}
