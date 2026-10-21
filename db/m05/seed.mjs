import mysql from 'mysql2/promise';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const fixtures={user_a:'a0000000-0000-4000-8000-000000000001',user_b:'a0000000-0000-4000-8000-000000000002',admin:'a0000000-0000-4000-8000-000000000003'};
export async function seed(options){
  if(process.env.IDENTITY_MODE!=='development'||process.env.APP_ENV==='production'||process.env.NODE_ENV==='production')throw new Error('DEVELOPMENT_SEED_ONLY');
  const c=await mysql.createConnection(options);
  try{await c.beginTransaction();
    for(const [key,id] of Object.entries(fixtures)){
      await c.execute('INSERT INTO users (id,phone_ciphertext,phone_lookup_hash,nickname) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[id,'TEST_ONLY_NO_PHONE',createHash('sha256').update('m05-fixture:'+key).digest('hex'),{user_a:'林小满 · A',user_b:'陈知夏 · B',admin:'轻养管理员'}[key]]);
      await c.execute('INSERT INTO user_roles (id,user_id,role) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=id',[randomUUID(),id,key==='admin'?'admin':'user']);
    }
    await c.commit();return {users:3,healthHistory:0,pointAccounts:'第③阶段开户',roleSource:'user_roles'};
  }catch(e){await c.rollback();throw e;}finally{await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  process.loadEnvFile('.env');console.log(await seed({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}));
}
