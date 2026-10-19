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
