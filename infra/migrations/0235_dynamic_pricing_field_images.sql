-- Dynamic pricing-field images use the existing storage layer. Upload rows are customer-owned
-- references; order_media remains the canonical order-facing media table after claim.
ALTER TABLE service_pricing_fields
  ADD COLUMN IF NOT EXISTS min_files smallint,
  ADD COLUMN IF NOT EXISTS max_files smallint;

ALTER TABLE service_pricing_fields
  DROP CONSTRAINT IF EXISTS service_pricing_fields_image_limits_check;
ALTER TABLE service_pricing_fields
  ADD CONSTRAINT service_pricing_fields_image_limits_check CHECK (
    (
      field_type = 'image_upload'
      AND min_files IS NOT NULL
      AND max_files IS NOT NULL
      AND min_files >= 0
      AND max_files BETWEEN 1 AND 10
      AND min_files <= max_files
      AND (is_required = false OR min_files >= 1)
    )
    OR (
      field_type <> 'image_upload'
      AND min_files IS NULL
      AND max_files IS NULL
    )
  );

CREATE TABLE IF NOT EXISTS pricing_field_uploads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id uuid NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES service_pricing_fields(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  file_url text NOT NULL,
  mime_type varchar(50) NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  claimed_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_field_uploads_claim_pair_check CHECK (
    (claimed_order_id IS NULL AND claimed_at IS NULL)
    OR (claimed_order_id IS NOT NULL AND claimed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pricing_field_uploads_customer_pending
  ON pricing_field_uploads(customer_id, expires_at)
  WHERE claimed_order_id IS NULL;

ALTER TABLE order_media
  ADD COLUMN IF NOT EXISTS pricing_field_upload_id uuid REFERENCES pricing_field_uploads(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_media_pricing_field_upload
  ON order_media(order_id, pricing_field_upload_id)
  WHERE pricing_field_upload_id IS NOT NULL;
