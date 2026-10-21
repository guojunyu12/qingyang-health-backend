"""Local input/extraction checks; does not replace full-team or MySQL verification."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
checksums = json.loads((root / 'contracts/CHECKSUMS.json').read_text())
for name, expected in checksums.items():
    actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
    assert actual == expected, f'Checksum mismatch: {name}'
refs = root / 'docs/M02/references'
module = (refs / 'M02_健康记录与个人看板_Agent工作包.md').read_text()
master = (refs / '00_六人分工与MySQL总契约.md').read_text()
for marker in ['COMMON_CONTRACT', 'SHARED_TYPES', 'CANONICAL_SQL', 'FIXTURE_IDS']:
    def extract(text):
        return text.split(f'<!-- BEGIN_{marker} -->', 1)[1].split(f'<!-- END_{marker} -->', 1)[0]
    assert extract(module) == extract(master), f'Attachment disagreement: {marker}'
sql = (root / 'db/migrations/V001__baseline.sql').read_text()
assert len(re.findall(r'^CREATE TABLE ', sql, re.M)) == 44
print('PASS: local checksums, supplied common contract/types/SQL/fixtures, 44-table baseline.')
print('NOT COVERED: full six-package consistency, MySQL execution or application acceptance; run their separate suites.')
dictionary = (refs / '01_数据库中文字段字典.md').read_text()
for table in ['health_profiles', 'water_records', 'weight_records']:
    section = re.search(r'^### .*`'+table+r'`.*?\n(.*?)(?=^### |\Z)', dictionary, re.M | re.S).group(1)
    dictionary_fields = re.findall(r'^\| `([a-z_]+)` \|', section, re.M)
    ddl = re.search(r'CREATE TABLE '+table+r' \((.*?)\n\) ENGINE', sql, re.S).group(1)
    sql_fields = re.findall(r'^\s+([a-z_]+) (?:CHAR|VARCHAR|DECIMAL|SMALLINT|INT|DATETIME|DATE)\b', ddl, re.M)
    assert dictionary_fields == sql_fields, f'Chinese dictionary column mismatch: {table}'
print('PASS: all 3 M02 table columns agree with 01 Chinese dictionary.')
