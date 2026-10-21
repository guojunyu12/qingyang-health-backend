import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {baselineSha} from './migrate.mjs';
export async function applyPhase6(options){const sql=await readFile(new URL('../migrations/V002__m05_messages.sql',import.meta.url),'utf8'),checksum=createHash('sha256').update(sql).digest('hex'),c=await mysql.createConnection({...options,dateStrings:true});let locked=false;try{
 const [[lock]]=await c.query("SELECT GET_LOCK(CONCAT(DATABASE(),':m05:migrate'),10) acquired");if(lock.acquired!==1)throw Error('MIGRATION_BUSY');locked=true;
 const [rows]=await c.query('SELECT version,checksum_sha256 FROM schema_migrations');if(!rows.some(r=>r.version==='V001'&&r.checksum_sha256===baselineSha))throw Error('BASELINE_REQUIRED');
 const existing=rows.find(r=>r.version==='V002_M05');if(existing){if(existing.checksum_sha256!==checksum)throw Error('V002_CHECKSUM_MISMATCH');return {applied:false,version:'V002_M05',businessTables:46};}
 const [partial]=await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('m05_message_campaigns','m05_message_recipients')");if(partial.length)throw Error('PARTIAL_MIGRATION_REQUIRES_REVIEW');
 for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await c.query(statement);
 await c.execute('INSERT INTO schema_migrations(version,checksum_sha256) VALUES (?,?)',['V002_M05',checksum]);return {applied:true,version:'V002_M05',businessTables:46};
 }finally{if(locked)await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':m05:migrate'))");await c.end();}}
if(process.argv[1]===fileURLToPath(import.meta.url)){process.loadEnvFile('.env');console.log(await applyPhase6({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_MIGRATION_USER,password:process.env.DB_MIGRATION_PASSWORD,database:process.env.DB_NAME}));}
