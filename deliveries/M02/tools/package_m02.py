"""Package M02 source explicitly, including server/ ignored by the frontend repository."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
root=Path(__file__).resolve().parents[1]
folders=['src/features/health','server/src/modules/health','contracts','db','docs/M02','tools','config']
files={root/'README.md',root/'ACCEPTANCE.md',root/'SOURCE_BASELINE.json',root/'src/features/dashboard/dashboard.tsx',root/'src/features/overview/overview.tsx',root/'tests/m02-validation.test.ts',root/'tests/m02-aggregation.test.ts',root/'tests/e2e/m02.spec.ts'}
for directory in folders:
    files.update(p for p in (root/directory).rglob('*') if p.is_file() and not any(x in p.parts for x in ['node_modules','__pycache__']))
artifacts=root/'artifacts';artifacts.mkdir(exist_ok=True)
output=artifacts/'M02_健康记录与个人看板_源码交付包.zip'
checksums={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
with ZipFile(output,'w',ZIP_DEFLATED) as archive:
    for p in sorted(files):archive.write(p,p.relative_to(root))
    archive.writestr('M02_FILE_CHECKSUMS.json',json.dumps(checksums,ensure_ascii=False,indent=2)+'\n')
print(f'Packaged {len(files)} source/contract/document files, including ignored backend module: {output}')
