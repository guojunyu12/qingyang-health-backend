import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
import {fileURLToPath} from 'node:url';
export const baselineSha='64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56';
export async function applyBaseline(options){
  const sql=await readFile(new URL('../migrations/V001__baseline.sql',import.meta.url),'utf8');
  if(createHash('sha256').update(sql).digest('hex')!==baselineSha) throw new Error('BASELINE_CHECKSUM_MISMATCH');
  const c=await mysql.createConnection({...options,multipleStatements:false,dateStrings:true});
  try {
    const [[v]]=await c.query('SELECT VERSION() AS version');if(!/^8\.4\./.test(v.version))throw new Error('MYSQL_8_4_REQUIRED');
    const [tables]=await c.query('SHOW TABLES');
    if(tables.length){
      if(tables.some(t=>Object.values(t).includes('schema_migrations'))){
        const [rows]=await c.query("SELECT checksum_sha256 FROM schema_migrations WHERE version='V001'");
        if(rows[0]?.checksum_sha256===baselineSha && (tables.length===45 || (tables.length===47 && (await c.query("SELECT version FROM schema_migrations WHERE version='V002_M05'"))[0].length===1)))return {applied:false,tables:44,version:'V001'};
      }
      throw new Error('NON_EMPTY_DATABASE_REFUSED: select a new empty development database; do not rerun a partial DDL');
    }
    // The immutable baseline has no procedural bodies or semicolons inside string literals.
    for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean)) await c.query(statement);
    await c.query(`CREATE TABLE schema_migrations (version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,checksum_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
    await c.execute('INSERT INTO schema_migrations (version,checksum_sha256) VALUES (?,?)',['V001',baselineSha]);
    const [[n]]=await c.query("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name<>'schema_migrations'");
    if(n.total!==44)throw new Error('BASELINE_TABLE_COUNT_MISMATCH');
    return {applied:true,tables:n.total,version:'V001'};
  }finally{await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  process.loadEnvFile('.env');
  const result=await applyBaseline({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_MIGRATION_USER,password:process.env.DB_MIGRATION_PASSWORD,database:process.env.DB_NAME});console.log(JSON.stringify(result));
}
