-- الشركة بقت مقدّم خدمة حقيقي في التوزيع التلقائي، لا مجرد معلومة على بروفايل العضو.
-- بنحفظ الشركة التي مثّلها العرض حتى قبول العضو يرسّي الطلب لنفس الشركة في المحاسبة والتقارير.

ALTER TABLE order_assignments
  ADD COLUMN IF NOT EXISTS provider_company_id uuid
    REFERENCES technician_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_assignments_provider_company_id
  ON order_assignments (provider_company_id)
  WHERE provider_company_id IS NOT NULL;

COMMENT ON COLUMN order_assignments.provider_company_id IS
  'الشركة التي دخلت كمقدّم خدمة في المطابقة التلقائية؛ null عندما العرض لفني مستقل/فرد.';

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.company_auto_match_boost', '2', 'number', 'matching',
   'أفضلية الشركة التجارية المؤهلة ككيان في التوزيع التلقائي. 0 يلغي الأفضلية فقط ولا يمنع الشركة من الترشح.', false)
ON CONFLICT (key) DO NOTHING;
