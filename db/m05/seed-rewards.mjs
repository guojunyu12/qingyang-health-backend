import mysql from 'mysql2/promise';
import {fileURLToPath} from 'node:url';
export async function seedRewards(options){
 if(process.env.IDENTITY_MODE!=='development'||process.env.ENABLE_DEV_REWARDS!=='true'||process.env.APP_ENV==='production'||process.env.NODE_ENV==='production'||Buffer.from(process.env.REWARD_CODE_KEY||'','base64').length!==32)throw new Error('EXPLICIT_DEVELOPMENT_PROVIDER_REQUIRED');
 const c=await mysql.createConnection({...options,timezone:'Z'});
 try{await c.query("SET SESSION time_zone = '+00:00'");await c.beginTransaction();let created=0;
 for(const [i,title,cost,stock,limit] of [[1,'午后茶饮 · 数字体验券',5,20,5],[2,'轻养食谱 · 数字阅读券',10,12,3],[3,'舒展时光 · 数字课程券',20,8,2]]){
 const id=`e5000000-0000-4000-8000-00000000000${i}`;
 const [exists]=await c.execute('SELECT id FROM point_rewards WHERE id=?',[id]);if(exists.length)continue;
 await c.execute("INSERT INTO point_rewards (id,title,description,cost_points,stock,daily_limit,status) VALUES (?,?,?,?,?,?,'published')",[id,title,'仅用于 M05 独立功能验收的测试权益。生成 TEST-ONLY 兑换码，不对应真实商品、课程或线下服务。每次兑换 1 份；失败退款仍计入当日次数。',cost,stock,limit]);created++;
 }await c.commit();return {createdRewards:created,existingContentUnchanged:true,createdOrders:0,changedBalances:0,testOnly:true};
 }catch(e){await c.rollback();throw e;}finally{await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){process.loadEnvFile('.env');console.log(await seedRewards({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}));}
