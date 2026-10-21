-- Upgrade verified V004 to V006; preserves existing business data.
-- Run once, stop at first error, never --force. DDL is not transactionally reversible.
SET SESSION time_zone='+00:00';
CREATE TEMPORARY TABLE qy_m05_upgrade_guard(n INT CHECK(n=0));
INSERT INTO qy_m05_upgrade_guard SELECT CASE WHEN (SELECT COUNT(*) FROM schema_migrations)=4 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V001' AND sha256='64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56')=1 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V002' AND sha256='5707e59b161cd0ab8b781f6480ce2dc26c14b91b6331e5c9175e90388639530f')=1 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V003' AND sha256='a134511f5f9c5e9be785c9c3f2baac4b9673f9871321d4206099d565e6f3ebdf')=1 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V004' AND sha256='176a63b5dc487c9f8c6665eab4db46038b311b29cd629cff5ab40a400ad86344')=1 THEN 0 ELSE 1 END;
DROP TEMPORARY TABLE qy_m05_upgrade_guard;
-- M05 additive migration after V004; managed by the M01 migration runner.
CREATE TABLE m05_message_campaigns (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 title VARCHAR(100) NOT NULL,
 body VARCHAR(500) NOT NULL,
 action_path VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '/messages',
 recipient_ids JSON NOT NULL,
 status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
 version INT NOT NULL DEFAULT 1,
 sent_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_m05_campaign_actor FOREIGN KEY(created_by) REFERENCES users(id),
 CONSTRAINT ck_m05_campaign_title CHECK(CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 100),
 CONSTRAINT ck_m05_campaign_body CHECK(CHAR_LENGTH(TRIM(body)) BETWEEN 1 AND 500),
 CONSTRAINT ck_m05_campaign_ids CHECK(JSON_TYPE(recipient_ids)='ARRAY' AND JSON_LENGTH(recipient_ids) BETWEEN 1 AND 100),
 CONSTRAINT ck_m05_campaign_status CHECK(status IN ('draft','queued','sending','completed','partial_failed')),
 CONSTRAINT ck_m05_campaign_version CHECK(version>=1),
 KEY ix_m05_campaign_created(created_at DESC,id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE m05_message_recipients (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 notification_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
 version INT NOT NULL DEFAULT 1,
 attempts INT NOT NULL DEFAULT 0,
 last_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
 locked_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 locked_until DATETIME(3) NULL,
 lease_version BIGINT NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT uq_m05_recipient UNIQUE(campaign_id,user_id),
 CONSTRAINT fk_m05_recipient_campaign FOREIGN KEY(campaign_id) REFERENCES m05_message_campaigns(id),
 CONSTRAINT fk_m05_recipient_user FOREIGN KEY(user_id) REFERENCES users(id),
 CONSTRAINT fk_m05_recipient_notice FOREIGN KEY(notification_id,user_id) REFERENCES notifications(id,user_id),
 CONSTRAINT ck_m05_recipient_status CHECK(status IN ('pending','processing','succeeded','failed')),
 CONSTRAINT ck_m05_recipient_version CHECK(version>=1 AND attempts>=0 AND lease_version>=0),
 CONSTRAINT ck_m05_recipient_lease CHECK((status='processing' AND locked_by IS NOT NULL AND locked_until IS NOT NULL) OR (status<>'processing' AND locked_by IS NULL AND locked_until IS NULL)),
 CONSTRAINT ck_m05_recipient_success CHECK(status<>'succeeded' OR notification_id IS NOT NULL),
 KEY ix_m05_recipient_due(status,locked_until,id),
 KEY ix_m05_recipient_page(campaign_id,created_at DESC,id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
ALTER TABLE notifications DROP CHECK ck_notifications_type, ADD CONSTRAINT ck_notifications_type CHECK(type IN ('training_reminder','booking_confirmed','booking_canceled','activity_canceled','redemption_result','operations_message'));

-- Rules are present but disabled until operations confirms their values.
-- Existing rules and balances are never overwritten.
INSERT INTO point_task_definitions(id,code,title,description,reward_points,scope,active) VALUES
(LOWER(CONCAT(HEX(RANDOM_BYTES(4)),'-',HEX(RANDOM_BYTES(2)),'-4',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-8',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-',HEX(RANDOM_BYTES(6)))),'daily_checkin','每日签到','每日签到任务，运营确认启用后生效',10,'daily',0),
(LOWER(CONCAT(HEX(RANDOM_BYTES(4)),'-',HEX(RANDOM_BYTES(2)),'-4',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-8',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-',HEX(RANDOM_BYTES(6)))),'daily_water','记录饮水','当日首次有效饮水，运营确认启用后生效',5,'daily',0),
(LOWER(CONCAT(HEX(RANDOM_BYTES(4)),'-',HEX(RANDOM_BYTES(2)),'-4',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-8',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-',HEX(RANDOM_BYTES(6)))),'daily_meal','确认饮食记录','当日首次有效饮食，运营确认启用后生效',10,'daily',0),
(LOWER(CONCAT(HEX(RANDOM_BYTES(4)),'-',HEX(RANDOM_BYTES(2)),'-4',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-8',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-',HEX(RANDOM_BYTES(6)))),'course_workout','完成课程训练','达到课程有效时长，运营确认启用后生效',20,'daily_course',0)
ON DUPLICATE KEY UPDATE code=point_task_definitions.code;

INSERT INTO schema_migrations(version,sha256)VALUES('V005','4d75a3a4b0580b47c13f5218e6ee14cad9d81efdb329b0541a246feb0905453b');

-- Initialize genuinely missing point accounts for existing M01 users.
-- No awards, no imported balances, no changes to existing accounts or ledgers.
INSERT INTO point_accounts(id,user_id)
SELECT LOWER(CONCAT(HEX(RANDOM_BYTES(4)),'-',HEX(RANDOM_BYTES(2)),'-4',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-8',SUBSTRING(HEX(RANDOM_BYTES(2)),2),'-',HEX(RANDOM_BYTES(6)))),u.id
FROM users u LEFT JOIN point_accounts p ON p.user_id=u.id
WHERE p.user_id IS NULL
ON DUPLICATE KEY UPDATE user_id=point_accounts.user_id;

INSERT INTO schema_migrations(version,sha256)VALUES('V006','7e9a6457795e614c9eec3ddcea19c895ea6a7ace78230457aa8d4f6ee4547d5a');
