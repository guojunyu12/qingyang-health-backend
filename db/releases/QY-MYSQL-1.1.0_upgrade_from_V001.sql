-- Only a verified V001 installation with no legacy phone identities may upgrade.
-- Never use mysql --force. Stop on the first error.
SET SESSION time_zone='+00:00';
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TEMPORARY TABLE qy_m01_upgrade_guard (invalid_state INT NOT NULL CHECK(invalid_state=0));
INSERT INTO qy_m01_upgrade_guard SELECT CASE WHEN
 (SELECT COUNT(*) FROM users)=0 AND (SELECT COUNT(*) FROM auth_challenges)=0
 AND (SELECT COUNT(*) FROM schema_migrations)=1
 AND (SELECT COUNT(*) FROM schema_migrations WHERE version='V001' AND sha256='64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56')=1
 THEN 0 ELSE 1 END;
DROP TEMPORARY TABLE qy_m01_upgrade_guard;
-- QY-MYSQL-1.1.0. Preflight rejects legacy phone identities.
ALTER TABLE users
 DROP CHECK ck_users_phone_cipher, DROP CHECK ck_users_phone_hash,
 RENAME COLUMN phone_ciphertext TO email_ciphertext,
 RENAME COLUMN phone_lookup_hash TO email_lookup_hash,
 RENAME INDEX uq_users_phone_hash TO uq_users_email_hash,
 ADD CONSTRAINT ck_users_email_cipher CHECK (CHAR_LENGTH(email_ciphertext)>0),
 ADD CONSTRAINT ck_users_email_hash CHECK (REGEXP_LIKE(email_lookup_hash,'^[0-9a-f]{64}$','c'));
ALTER TABLE auth_challenges
 DROP CHECK ck_auth_phone_hash, DROP CHECK ck_auth_phone_cipher,
 RENAME COLUMN phone_ciphertext TO email_ciphertext,
 RENAME COLUMN phone_lookup_hash TO email_lookup_hash,
 RENAME INDEX ix_auth_phone_created TO ix_auth_email_created,
 ADD CONSTRAINT ck_auth_email_cipher CHECK (CHAR_LENGTH(email_ciphertext)>0),
 ADD CONSTRAINT ck_auth_email_hash CHECK (REGEXP_LIKE(email_lookup_hash,'^[0-9a-f]{64}$','c')),
 ADD COLUMN delivery_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
 ADD CONSTRAINT ck_auth_delivery_status CHECK (delivery_status IN ('pending','sent','failed'));
ALTER TABLE user_sessions
 ADD COLUMN access_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN access_expires_at DATETIME(3) NULL,
 ADD UNIQUE KEY uq_sessions_access_hash(access_token_hash);

-- Preserve original upload metadata; describe the validated safe copy separately.
ALTER TABLE media_assets
 ADD COLUMN safe_content_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN safe_size_bytes BIGINT NULL,
 ADD CONSTRAINT ck_media_safe_metadata CHECK (
   (safe_content_type IS NULL AND safe_size_bytes IS NULL)
   OR (safe_content_type='image/webp' AND safe_size_bytes>0)
 );

-- Dedicated encrypted 30-second authentication retries; never stored in ordinary idempotency responses.
ALTER TABLE auth_challenges
 ADD COLUMN retry_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN retry_body_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN retry_ciphertext TEXT NULL,
 ADD COLUMN retry_expires_at DATETIME(3) NULL;
ALTER TABLE refresh_tokens
 ADD COLUMN retry_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN retry_body_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN retry_ciphertext TEXT NULL,
 ADD COLUMN retry_expires_at DATETIME(3) NULL;

INSERT INTO schema_migrations(version,sha256)VALUES('V002','5707e59b161cd0ab8b781f6480ce2dc26c14b91b6331e5c9175e90388639530f');
INSERT INTO schema_migrations(version,sha256)VALUES('V003','a134511f5f9c5e9be785c9c3f2baac4b9673f9871321d4206099d565e6f3ebdf');
INSERT INTO schema_migrations(version,sha256)VALUES('V004','176a63b5dc487c9f8c6665eab4db46038b311b29cd629cff5ab40a400ad86344');
