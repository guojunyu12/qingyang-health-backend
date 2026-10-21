-- Initialize genuinely missing point accounts for existing M01 users.
-- No awards, no imported balances, no changes to existing accounts or ledgers.
INSERT INTO point_accounts(id,user_id)
SELECT LOWER(CONCAT(HEX(RANDOM_BYTES(4)),'-',HEX(RANDOM_BYTES(2)),'-4',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-8',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-',HEX(RANDOM_BYTES(6)))),u.id
FROM users u LEFT JOIN point_accounts p ON p.user_id=u.id
WHERE p.user_id IS NULL
ON DUPLICATE KEY UPDATE user_id=point_accounts.user_id;
