import {createApplication} from './application';
import {loadConfig} from './common/config';
async function main(){
  const config=loadConfig('h5');const runtime=await createApplication(config);
  await runtime.app.listen(config.port,'127.0.0.1');console.log(`M05 H5 API http://127.0.0.1:${config.port}`);
  for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void runtime.close().then(()=>process.exit(0));});
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
