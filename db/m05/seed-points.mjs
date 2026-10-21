import mysql from 'mysql2/promise';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
export async function seedPoints(options){
 if(process.env.IDENTITY_MODE!=='development'||process.env.APP_ENV==='production'||process.env.NODE_ENV==='production')throw new Error('DEVELOPMENT_SEED_ONLY');
 const c=await mysql.createConnection(options);
 try{await c.beginTransaction();
 const rules=[['daily_checkin','每日签到','每天来看看，让健康成为日常。',10,'daily'],['daily_water','记录饮水','今天记录一杯水，每日奖励一次。',5,'daily'],['daily_meal','确认饮食记录','确认一条含食物明细的当日饮食记录。',10,'daily'],['course_workout','完成课程训练','有效训练达到课程快照时长的 80%，同课程每日奖励一次。',20,'daily_course']];
 for(const [code,title,description,points,scope] of rules)await c.execute('INSERT INTO point_task_definitions (id,code,title,description,reward_points,scope) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE code=code',[randomUUID(),code,title,description,points,scope]);
 const [users]=await c.execute('SELECT id FROM users ORDER BY id FOR UPDATE');
 for(const user of users)await c.execute('INSERT INTO point_accounts (id,user_id) VALUES (?,?) ON DUPLICATE KEY UPDATE user_id=user_id',[randomUUID(),user.id]);
 await c.commit();return {rules:4,accountsInitialized:users.length,existingBalancesUnchanged:true};
 }catch(e){await c.rollback();throw e;}finally{await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){process.loadEnvFile('.env');console.log(await seedPoints({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}));}
