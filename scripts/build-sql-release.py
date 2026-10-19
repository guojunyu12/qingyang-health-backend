from pathlib import Path
import hashlib,re
root=Path(__file__).resolve().parents[1]; folder=root/'db/migrations'
base=(folder/'V001__baseline.sql').read_text();email=(folder/'V002__email_identity.sql').read_text();safe=(folder/'V003__safe_media_metadata.sql').read_text();retry=(folder/'V004__encrypted_auth_retry.sql').read_text()
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
assert sha(base)=='64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56'
header='-- 轻养健康 QY-MYSQL-1.1.0 新空库安装，MySQL 8.4 / InnoDB\n-- 先由管理员创建空数据库并选中；不得在已有V001或有业务数据的库执行。\n-- 不包含密码、测试账号、演示数据，也不关闭外键。不要使用 mysql --force。\n\n'
history="\nCREATE TABLE schema_migrations(version VARCHAR(16) PRIMARY KEY,sha256 CHAR(64) NOT NULL,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3));\n"+''.join("INSERT INTO schema_migrations(version,sha256)VALUES('"+v+"','"+sha(s)+"');\n" for v,s in [('V001',base),('V002',email),('V003',safe),('V004',retry)])
(root/'db/releases/QY-MYSQL-1.1.0_full_install.sql').write_text(header+base+'\n'+email+'\n'+safe+'\n'+retry+history)
# M01-only schema reference: derive its final DDL by applying the same rename transformations.
sections=re.split(r'(?=-- @table )',base)
m01=''.join(x for x in sections if re.match(r'-- @table \w+ owner=M01',x))
# Last M01 section ends before M02, therefore only table statements are present.
prefix=base[:base.index('-- @table')]
foreign='\n'.join(line for line in base.splitlines() if line.startswith('ALTER TABLE ') and line.split()[2] in {'users','auth_challenges','user_sessions','refresh_tokens','media_assets','notification_subscriptions','notifications','notification_deliveries','idempotency_requests','outbox_events','user_roles','audit_logs'})
(root/'db/releases/M01_12_tables_reference.sql').write_text('-- M01专属12表参考。仅供独立空库检查，不登记全库迁移版本。\n-- 完整应用与线上团队数据库请执行full_install.sql，切勿同时执行两份。\n'+prefix+m01+'\n'+foreign+'\n'+email+'\n'+safe+'\n'+retry)
guard="""-- Only a verified V001 installation with no legacy phone identities may upgrade.
-- Never use mysql --force. Stop on the first error.
CREATE TEMPORARY TABLE qy_m01_upgrade_guard (invalid_state INT NOT NULL CHECK(invalid_state=0));
INSERT INTO qy_m01_upgrade_guard SELECT CASE WHEN
 (SELECT COUNT(*) FROM users)=0 AND (SELECT COUNT(*) FROM auth_challenges)=0
 AND (SELECT COUNT(*) FROM schema_migrations)=1
 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V001' AND sha256='64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56')=1
 THEN 0 ELSE 1 END;
DROP TEMPORARY TABLE qy_m01_upgrade_guard;
"""
upgrade_history=''.join("INSERT INTO schema_migrations(version,sha256)VALUES('"+v+"','"+sha(text)+"');\n" for v,text in [('V002',email),('V003',safe),('V004',retry)])
(root/'db/releases/QY-MYSQL-1.1.0_upgrade_from_V001.sql').write_text(guard+email+'\n'+safe+'\n'+retry+'\n'+upgrade_history)
(root/'db/releases/SHA256SUMS.txt').write_text(''.join(sha(p.read_text())+'  '+p.name+'\n' for p in sorted((root/'db/releases').glob('*.sql'))))
print('Generated full fresh install and M01-only 12-table reference SQL.')
