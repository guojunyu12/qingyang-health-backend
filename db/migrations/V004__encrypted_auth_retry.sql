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
