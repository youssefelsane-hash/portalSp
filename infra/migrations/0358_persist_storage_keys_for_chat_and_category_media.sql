-- R2/S3 read URLs are presigned and expire. Keep the permanent object key alongside
-- the legacy URL so new reads can sign a fresh URL while old rows remain usable.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS storage_key text NULL;

ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS icon_storage_key text NULL,
  ADD COLUMN IF NOT EXISTS cover_image_storage_key text NULL;
