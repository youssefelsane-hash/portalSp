-- Connect legacy service workmanship warranties to the customer warranty product,
-- and enforce claim/order identities that the initial project migration left open.

ALTER TABLE customer_warranties
  ADD COLUMN coverage_days INTEGER NULL CHECK (coverage_days IS NULL OR coverage_days > 0);

ALTER TABLE customer_warranties
  ADD CONSTRAINT chk_customer_warranties_claim_usage
  CHECK (claims_used >= 0 AND claims_used <= max_claims);

CREATE UNIQUE INDEX uq_customer_warranties_source_order
  ON customer_warranties (order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX uq_warranty_claims_one_active
  ON warranty_claims (warranty_id)
  WHERE status IN ('open', 'under_review', 'inspection_scheduled', 'approved', 'repair_in_progress');

INSERT INTO warranty_plans (
  slug, name_ar, warranty_type, pricing_model, price_value, coverage_months,
  max_claims, terms_ar, exclusions_ar, liability_bearer, is_active
) VALUES (
  'system-service-workmanship',
  'ضمان تنفيذ الخدمة',
  'workmanship',
  'fixed',
  0,
  1,
  1,
  'يغطي عيوب تنفيذ الخدمة خلال المدة المحددة على الطلب.',
  'لا يغطي التلف الناتج عن سوء الاستخدام أو أعمال طرف آخر.',
  'provider',
  true
)
ON CONFLICT (slug) DO NOTHING;

-- Make pre-migration completed orders visible in the unified warranty screen too.
INSERT INTO customer_warranties (
  plan_id, plan_version, order_id, project_id, customer_id, name_ar,
  warranty_type, price_paid_cents, coverage_months, coverage_days,
  max_coverage_cents, max_claims, terms_ar, exclusions_ar,
  starts_at, expires_at, claims_used
)
SELECT wp.id, wp.version, o.id, o.project_id, o.customer_id, wp.name_ar,
       wp.warranty_type, 0,
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM (o.warranty_expires_at - COALESCE(o.work_completed_at, o.updated_at))) / 2592000.0)::integer),
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM (o.warranty_expires_at - COALESCE(o.work_completed_at, o.updated_at))) / 86400.0)::integer),
       wp.max_coverage_cents, wp.max_claims, wp.terms_ar, wp.exclusions_ar,
       COALESCE(o.work_completed_at, o.updated_at), o.warranty_expires_at, 0
FROM orders o
CROSS JOIN warranty_plans wp
WHERE wp.slug = 'system-service-workmanship'
  AND o.warranty_expires_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM customer_warranties cw WHERE cw.order_id = o.id)
ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING;
