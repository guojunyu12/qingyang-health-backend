"""Verify an existing local V001 against a fresh disposable schema before adoption."""
from pathlib import Path
import subprocess,uuid,hashlib
root=Path(__file__).resolve().parents[1]; workspace=root.parent
mysql='/opt/homebrew/opt/mysql@8.4/bin/mysql'
admin=workspace/'.local/mysql-admin.cnf'
def query(s):
 p=subprocess.run([mysql,'--defaults-extra-file='+str(admin),'--batch','--skip-column-names'],input=s,text=True,capture_output=True)
 if p.returncode: raise RuntimeError('Baseline verification SQL failed (credentials suppressed)')
 return p.stdout
sql=(root/'db/migrations/V001__baseline.sql').read_text();sha=hashlib.sha256(sql.encode()).hexdigest()
assert sha=='64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56'
tmp='qingyang_verify_'+uuid.uuid4().hex[:12]
try:
 query('CREATE DATABASE '+tmp+'; USE '+tmp+';\n'+sql)
 expected=query("SELECT table_name FROM information_schema.tables WHERE table_schema='"+tmp+"' ORDER BY table_name;").splitlines()
 actual=query("SELECT table_name FROM information_schema.tables WHERE table_schema='qingyang_dev_m01' AND table_name<>'schema_migrations' ORDER BY table_name;").splitlines()
 assert expected==actual,'Table set mismatch'
 for table in expected:
  assert query('SHOW CREATE TABLE '+tmp+'.'+table+';')==query('SHOW CREATE TABLE qingyang_dev_m01.'+table+';'),'DDL mismatch: '+table
 query("USE qingyang_dev_m01; CREATE TABLE IF NOT EXISTS schema_migrations(version VARCHAR(16) PRIMARY KEY,sha256 CHAR(64) NOT NULL,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)); INSERT INTO schema_migrations(version,sha256) VALUES('V001','"+sha+"');")
 print('Existing 44-table schema verified against clean V001 and adopted.')
finally:
 query('DROP DATABASE '+tmp+';')
