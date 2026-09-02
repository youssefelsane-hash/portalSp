-- baytak — 0247: ADR-0063 unified assessment, immutable quote versions and booking price lock.
--
-- Existing formula services keep their behaviour. Existing inspection_then_quote services are
-- explicitly classified as assessment_required. min/max_price_cents remain engine clamps and are
-- deliberately not reused as a customer-facing estimated range.

ALTER TYPE order_status ADD VALUE 'awaiting_technician_selection';

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS price_certainty_mode varchar(30) NOT NULL DEFAULT 'confirmed_price',
  ADD COLUMN IF NOT EXISTS assessment_route_policy varchar(30) NOT NULL DEFAULT 'admin_triage',
  ADD COLUMN IF NOT EXISTS remote_assessment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remote_assessment_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onsite_assessment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assessment_fee_credit_mode varchar(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS assessment_fee_credit_bps integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onsite_assessor_executes_work boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quote_validity_minutes integer NOT NULL DEFAULT 2880,
  ADD COLUMN IF NOT EXISTS display_price_min_cents integer,
  ADD COLUMN IF NOT EXISTS display_price_max_cents integer,
  ADD COLUMN IF NOT EXISTS require_admin_review_above_range boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_quote_increase_without_admin_review_bps integer NOT NULL DEFAULT 0;

UPDATE services
   SET price_certainty_mode = 'assessment_required',
       assessment_route_policy = 'admin_triage',
       remote_assessment_enabled = true,
       onsite_assessment_enabled = true
 WHERE pricing_model::text = 'inspection_then_quote';

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS chk_services_price_certainty_mode,
  ADD CONSTRAINT chk_services_price_certainty_mode CHECK (
    price_certainty_mode IN ('confirmed_price', 'estimated_range', 'assessment_required')
  ),
  DROP CONSTRAINT IF EXISTS chk_services_assessment_route_policy,
  ADD CONSTRAINT chk_services_assessment_route_policy CHECK (
    assessment_route_policy IN ('admin_triage', 'remote_only', 'onsite_only', 'customer_choice')
  ),
  DROP CONSTRAINT IF EXISTS chk_services_assessment_credit_mode,
  ADD CONSTRAINT chk_services_assessment_credit_mode CHECK (
    assessment_fee_credit_mode IN ('none', 'full', 'percentage')
  ),
  DROP CONSTRAINT IF EXISTS chk_services_assessment_policy_values,
  ADD CONSTRAINT chk_services_assessment_policy_values CHECK (
    remote_assessment_fee_cents >= 0
    AND assessment_fee_credit_bps BETWEEN 0 AND 10000
    AND quote_validity_minutes BETWEEN 5 AND 43200
    AND max_quote_increase_without_admin_review_bps BETWEEN 0 AND 100000
    AND (display_price_min_cents IS NULL OR display_price_min_cents >= 0)
    AND (display_price_max_cents IS NULL OR display_price_max_cents >= display_price_min_cents)
  );

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS price_status varchar(30) NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS price_certainty_mode_snapshot varchar(30) NOT NULL DEFAULT 'confirmed_price',
  ADD COLUMN IF NOT EXISTS assessment_type varchar(20),
  ADD COLUMN IF NOT EXISTS remote_assessment_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assessment_fee_credit_mode_snapshot varchar(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS assessment_fee_credit_bps_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assessment_fee_credit_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS display_price_min_cents_snapshot integer,
  ADD COLUMN IF NOT EXISTS display_price_max_cents_snapshot integer,
  ADD COLUMN IF NOT EXISTS onsite_assessor_executes_work_snapshot boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selected_match_preview_id uuid;

UPDATE orders o
   SET price_certainty_mode_snapshot = s.price_certainty_mode,
       price_status = CASE
         WHEN o.order_status::text = 'awaiting_admin_quote' THEN 'waiting_assessment'
         WHEN o.order_status::text = 'awaiting_initial_quote_approval' THEN 'waiting_customer_approval'
         WHEN s.price_certainty_mode = 'estimated_range' THEN 'provisional'
         ELSE 'confirmed'
       END,
       assessment_type = CASE
         WHEN o.initial_quote_source = 'admin_remote' THEN 'remote'
         WHEN o.initial_quote_source = 'technician_onsite' OR o.inspection_fee_cents > 0 THEN 'onsite'
         ELSE NULL
       END
  FROM services s
 WHERE s.id = o.service_id;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_price_status,
  ADD CONSTRAINT chk_orders_price_status CHECK (
    price_status IN ('confirmed', 'provisional', 'waiting_assessment', 'waiting_quote',
                     'waiting_customer_approval', 'locked')
  ),
  DROP CONSTRAINT IF EXISTS chk_orders_price_certainty_snapshot,
  ADD CONSTRAINT chk_orders_price_certainty_snapshot CHECK (
    price_certainty_mode_snapshot IN ('confirmed_price', 'estimated_range', 'assessment_required')
  ),
  DROP CONSTRAINT IF EXISTS chk_orders_assessment_type,
  ADD CONSTRAINT chk_orders_assessment_type CHECK (assessment_type IS NULL OR assessment_type IN ('remote', 'onsite')),
  DROP CONSTRAINT IF EXISTS chk_orders_assessment_financials,
  ADD CONSTRAINT chk_orders_assessment_financials CHECK (
    remote_assessment_fee_cents >= 0
    AND assessment_fee_credit_bps_snapshot BETWEEN 0 AND 10000
    AND assessment_fee_credit_cents >= 0
    AND (display_price_min_cents_snapshot IS NULL OR display_price_min_cents_snapshot >= 0)
    AND (display_price_max_cents_snapshot IS NULL OR display_price_max_cents_snapshot >= display_price_min_cents_snapshot)
  );

CREATE TABLE order_quotes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  source varchar(30) NOT NULL CHECK (source IN ('admin_remote', 'technician_onsite', 'technician_diagnosis')),
  status varchar(30) NOT NULL CHECK (status IN (
    'pending_admin_review', 'pending_customer', 'approved', 'rejected', 'expired', 'superseded'
  )),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  diagnosis text,
  scope_included text,
  scope_excluded text,
  estimated_duration_minutes integer CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0),
  required_technicians smallint CHECK (required_technicians IS NULL OR required_technicians > 0),
  required_assistants smallint CHECK (required_assistants IS NULL OR required_assistants >= 0),
  expected_min_cents integer,
  expected_max_cents integer,
  revision_reason text,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id),
  admin_decided_by_user_id uuid REFERENCES users(id),
  admin_decided_at timestamptz,
  customer_decided_by_user_id uuid REFERENCES users(id),
  customer_decided_at timestamptz,
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, version),
  CONSTRAINT chk_order_quotes_expected_range CHECK (
    (expected_min_cents IS NULL AND expected_max_cents IS NULL)
    OR (expected_min_cents >= 0 AND expected_max_cents >= expected_min_cents)
  )
);

CREATE UNIQUE INDEX uq_order_quotes_one_live
  ON order_quotes(order_id)
  WHERE status IN ('pending_admin_review', 'pending_customer');
CREATE INDEX idx_order_quotes_admin_queue
  ON order_quotes(status, created_at)
  WHERE status IN ('pending_admin_review', 'pending_customer');

CREATE TABLE booking_match_previews (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id uuid NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id),
  address_id uuid NOT NULL REFERENCES addresses(id),
  technician_id uuid REFERENCES technician_profiles(id),
  technician_company_id uuid REFERENCES technician_companies(id),
  selection_mode varchar(10) NOT NULL CHECK (selection_mode IN ('auto', 'manual')),
  context_hash varchar(64) NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  final_price_cents integer NOT NULL CHECK (final_price_cents >= 0),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'stale', 'expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_booking_match_preview_provider CHECK (
    (technician_id IS NOT NULL AND technician_company_id IS NULL)
    OR (technician_id IS NULL AND technician_company_id IS NOT NULL)
  ),
  CONSTRAINT chk_booking_match_preview_consumed CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status <> 'consumed' AND consumed_at IS NULL)
  )
);

CREATE INDEX idx_booking_match_previews_active_customer
  ON booking_match_previews(customer_id, expires_at)
  WHERE status = 'active';

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_selected_match_preview
  FOREIGN KEY (selected_match_preview_id) REFERENCES booking_match_previews(id) ON DELETE SET NULL;

COMMENT ON COLUMN services.min_price_cents IS
  'Pricing-engine lower clamp. Never expose as the customer estimated-range minimum.';
COMMENT ON COLUMN services.max_price_cents IS
  'Pricing-engine upper clamp. Never expose as the customer estimated-range maximum.';

