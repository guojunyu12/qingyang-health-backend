/** Isolated browser harness only. No production imports, fixture identity or reward port. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
if(process.env.NODE_ENV==='production'||!process.env.DB_NAME?.endsWith('_test')||process.env.AUTH_NO_LISTEN!=='1')throw Error('Explicit isolated test environment required');
const {IdentityService}=await import('../../src/modules/identity/service.js');
const {createApp}=await import('../../src/main.js');
const {modulePorts}=await import('../../src/common/ports.js');
// Explicit negative dependency scenario; normal live runs retain the integrated M05 port.
if(process.env.QY_LIVE_POINTS_UNAVAILABLE==='1')delete modulePorts.points;
await mkdir(resolve('.local'),{recursive:true});
const identity=new IdentityService(async(_email,code)=>{await writeFile(resolve('.local/m03-e2e-code'),code,{mode:0o600})});
const port=Number(process.env.M03_LIVE_PORT??'3102');
const app=await createApp(identity);await app.listen(port,'127.0.0.1');
console.log('Isolated M03 browser API ready on '+port);
