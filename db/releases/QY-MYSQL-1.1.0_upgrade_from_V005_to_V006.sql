-- Upgrade verified V005 to V006; preserves existing business data.
-- Run once, stop at first error, never --force. DDL is not transactionally reversible.
SET SESSION time_zone='+00:00';
CREATE TEMPORARY TABLE qy_m05_upgrade_guard(n INT CHECK(n=0));
INSERT INTO qy_m05_upgrade_guard SELECT CASE WHEN (SELECT COUNT(*) FROM schema_migrations)=5 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V001' AND sha256='64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56')=1 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V002' AND sha256='5707e59b161cd0ab8b781f6480ce2dc26c14b91b6331e5c9175e90388639530f')=1 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V003' AND sha256='a134511f5f9c5e9be785c9c3f2baac4b9673f9871321d4206099d565e6f3ebdf')=1 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V004' AND sha256='176a63b5dc487c9f8c6665eab4db46038b311b29cd629cff5ab40a400ad86344')=1 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V005' AND sha256='4d75a3a4b0580b47c13f5218e6ee14cad9d81efdb329b0541a246feb0905453b')=1 THEN 0 ELSE 1 END;
DROP TEMPORARY TABLE qy_m05_upgrade_guard;
-- Initialize genuinely missing point accounts for existing M01 users.
-- No awards, no imported balances, no changes to existing accounts or ledgers.
INSERT INTO point_accounts(id,user_id)
SELECT LOWER(CONCAT(HEX(RANDOM_BYTES(4)),'-',HEX(RANDOM_BYTES(2)),'-4',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-8',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-',HEX(RANDOM_BYTES(6)))),u.id
FROM users u LEFT JOIN point_accounts p ON p.user_id=u.id
WHERE p.user_id IS NULL
ON DUPLICATE KEY UPDATE user_id=point_accounts.user_id;

INSERT INTO schema_migrations(version,sha256)VALUES('V006','7e9a6457795e614c9eec3ddcea19c895ea6a7ace78230457aa8d4f6ee4547d5a');
