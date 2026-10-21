import {createApplication} from './application';
import {loadConfig} from './common/config';
async function main(){
  const config=loadConfig('admin');const runtime=await createApplication(config);
  await runtime.app.listen(config.port,'127.0.0.1');console.log(`M05 Admin API http://127.0.0.1:${config.port}`);
  for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void runtime.close().then(()=>process.exit(0));});
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
