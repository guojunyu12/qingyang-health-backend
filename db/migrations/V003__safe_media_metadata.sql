-- Preserve original upload metadata; describe the validated safe copy separately.
ALTER TABLE media_assets
 ADD COLUMN safe_content_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN safe_size_bytes BIGINT NULL,
 ADD CONSTRAINT ck_media_safe_metadata CHECK (
   (safe_content_type IS NULL AND safe_size_bytes IS NULL)
   OR (safe_content_type='image/webp' AND safe_size_bytes>0)
 );
