-- baytak — 0096: إنتاجية configurable (docs/08 §14) — طبقة تسجيل موزون ثانية فوق نفس بيانات
-- technician_kpi_snapshots الموجودة (مفيش جدول جديد، مفيش جمع بيانات جديد — Phase 1 حسابي بالكامل).

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('productivity.enabled', 'true', 'boolean', 'productivity', 'تفعيل نظام تسجيل الإنتاجية configurable (docs/08 §14)', false),
  ('productivity.default_evaluation_period_months', '1', 'number', 'productivity', 'عدد الشهور الافتراضي لتجميع بيانات الإنتاجية لو مفيش months مبعوت في الطلب', false),
  (
    'productivity.metrics_config',
    '{
      "completed_orders": {"enabled": true, "weight": 20, "direction": "higher_is_better", "minSampleSize": 1, "target": 20},
      "completion_rate": {"enabled": true, "weight": 15, "direction": "higher_is_better", "minSampleSize": 1},
      "acceptance_rate": {"enabled": true, "weight": 10, "direction": "higher_is_better", "minSampleSize": 1},
      "cancellation_rate": {"enabled": true, "weight": 15, "direction": "lower_is_better", "minSampleSize": 1},
      "complaint_rate": {"enabled": true, "weight": 15, "direction": "lower_is_better", "minSampleSize": 1},
      "customer_rating": {"enabled": true, "weight": 10, "direction": "higher_is_better", "minSampleSize": 1},
      "revenue_delivered": {"enabled": true, "weight": 10, "direction": "higher_is_better", "minSampleSize": 1, "target": 5000000},
      "monthly_kpi_score": {"enabled": true, "weight": 5, "direction": "higher_is_better", "minSampleSize": 1}
    }'::jsonb,
    'json',
    'productivity',
    'تفعيل/وزن/اتجاه/حجم عينة أدنى لكل مقياس إنتاجية — قابل للتعديل الكامل من /settings (محرر JSON العام)، صفر قيم دائمة في الكود',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- صلاحية قراءة بس (Phase 1 مفيش موافقة/دفع، فمفيش صلاحيات approve/override_max زي KPI).
INSERT INTO permissions (name, resource, action) VALUES
  ('technician_productivity.view', 'technician_productivity', 'view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'technician_productivity.view'
WHERE r.name IN ('ops_manager', 'finance');
