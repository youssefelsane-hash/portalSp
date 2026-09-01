CREATE TABLE IF NOT EXISTS order_problem_image_uploads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id uuid NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  file_url text NOT NULL,
  mime_type varchar(50) NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  claimed_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_problem_image_uploads_claim_pair_check CHECK (
    (claimed_order_id IS NULL AND claimed_at IS NULL)
    OR (claimed_order_id IS NOT NULL AND claimed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_order_problem_image_uploads_customer_pending
  ON order_problem_image_uploads(customer_id, expires_at)
  WHERE claimed_order_id IS NULL;

ALTER TABLE order_media
  ADD COLUMN IF NOT EXISTS problem_image_upload_id uuid
    REFERENCES order_problem_image_uploads(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_media_problem_image_upload
  ON order_media(order_id, problem_image_upload_id)
  WHERE problem_image_upload_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS initial_quote_source varchar(30);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_initial_quote_source;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_initial_quote_source CHECK (
    initial_quote_source IS NULL
    OR initial_quote_source IN ('technician_onsite', 'admin_remote')
  );
