/** Local full-stack test harness. Never imported by src/main.ts or production. */
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
if(process.env.NODE_ENV==='production' || !process.env.DB_NAME?.endsWith('_test') || process.env.AUTH_NO_LISTEN!=='1') throw Error('Live harness requires an explicit isolated test database');
const {IdentityService}=await import('../../src/modules/identity/service.js');
const {createApp}=await import('../../src/main.js');
const folder=resolve('.local');await mkdir(folder,{recursive:true});
const identity=new IdentityService(async (_email,code)=>{await writeFile(resolve(folder,'m02-e2e-code'),code,{mode:0o600})});
const app=await createApp(identity);await app.listen(3002,'127.0.0.1');console.log('Isolated M02 browser API ready');
