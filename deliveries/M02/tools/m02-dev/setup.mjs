import { spawnSync } from 'node:child_process';
import { access, copyFile, lstat, mkdir, realpath, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 9)) throw new Error('请使用 Node.js 22.9 或更高版本');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const cwd of [root, path.join(root, 'tools/m02-dev')]) {
  console.log(`Installing ${cwd === root ? 'frontend' : 'M02 local API'} locked dependencies…`);
  const result = spawnSync(npm, ['ci'], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const target=path.join(root,'tools/m02-dev/node_modules');
const link=path.join(root,'server/node_modules');
await mkdir(path.dirname(link),{recursive:true});
try {
  const stat=await lstat(link);
  if (stat.isSymbolicLink() && await realpath(link)!==await realpath(target)) throw new Error('server/node_modules 已指向其他依赖，请保留团队配置并手动核对');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await symlink(target,link,process.platform==='win32'?'junction':'dir');
}
for(const [source,destination] of [['config/frontend.env.example','.env.local'],['config/api.env.example','.env.api']]) {
  const output=path.join(root,destination);
  try { await access(output); console.log(`Keeping existing ${destination}`); }
  catch { await copyFile(path.join(root,source),output); console.log(`Created ${destination} from a credential-free example`); }
}
console.log('Dependencies ready. Set your development MySQL credentials in .env.api; see ACCEPTANCE.md for startup and manual acceptance.');
