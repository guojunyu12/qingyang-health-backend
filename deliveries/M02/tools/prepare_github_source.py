"""Prepare one clean source tree for the explicitly authorized public GitHub repository."""
from pathlib import Path
import shutil,json,hashlib
root=Path(__file__).resolve().parents[1]
out=root/'.local/github-release/project'
out.mkdir(parents=True,exist_ok=True)
selected=set()
folders=['src','public','server/src/modules/health','contracts','db','config','docs/M02','tools','tests']
files=['README.md','ACCEPTANCE.md','SOURCE_BASELINE.json','.gitignore','AGENTS.md','package.json','package-lock.json','next.config.ts','next-env.d.ts','tsconfig.json','vitest.config.ts','playwright.config.ts']
for folder in folders:
    for p in (root/folder).rglob('*'):
        if not p.is_file() or any(part in ['node_modules','__pycache__','.git','.local','.next'] for part in p.relative_to(root).parts):continue
        target=out/p.relative_to(root);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target);selected.add(target)
for name in files:
    shutil.copy2(root/name,out/name);selected.add(out/name)
manifest={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(selected)}
(out/'SOURCE_CHECKSUMS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'Prepared {len(manifest)} source files in {out}')
