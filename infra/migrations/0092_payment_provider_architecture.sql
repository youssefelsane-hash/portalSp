-- baytak — 0092: معمارية دفع provider-agnostic (ADR-0013، توجيه المالك 2026-08-14)
-- (1) صلاحية تأكيد InstaPay يدوي — Finance/Admin بس، مخصوصة (مش refunds.issue ولا أي صلاحية عامة).
INSERT INTO permissions (name, resource, action) VALUES
  ('payments.confirm_manual', 'payments', 'confirm_manual');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'payments.confirm_manual'
WHERE r.name IN ('super_admin', 'finance');

-- (2) استرداد حقيقي — unique index حقيقي بدل فحص "موجود قبل كده" جوّه قفل الطلب بس (دفاع مزدوج،
-- ADR-0013 §7). دفعة وحدة = استرداد واحد أقصى (كامل أو جزئي)، مفيش تراكم استردادات جزئية متعددة
-- لنفس الدفعة في Phase 1 — قرار مبسّط مقصود، نفس مبدأ "بلا over-engineering" من توجيه المالك.
DROP INDEX IF EXISTS idx_refunds_payment_id;
CREATE UNIQUE INDEX idx_refunds_payment_id_unique ON refunds(payment_id);

-- (3) Fawry معطّل خلف إعداد صريح — "مش أولوية V1" بس مش محذوف (توجيه المالك). false افتراضيًا:
-- حتى لو env vars اتظبطت بالغلط في بيئة، الكود العادي ميعرضش Fawry كطريقة دفع من غير قرار أدمن صريح.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.fawry_enabled', 'false', 'boolean', 'payments', 'تفعيل الدفع بكود فوري المرجعي (Fawry) — معطّل افتراضيًا، مش أولوية V1 (ADR-0013)', false)
ON CONFLICT (key) DO NOTHING;

-- (4) نافذة تأكيد InstaPay اليدوي — قابلة للتحكم من الأدمن (ADR-0013 §7)، مش رقم دائم مُخترع.
-- بعد انتهاء الصلاحية بتوقف تذكيرات action_required (§13) — مفيش دفع ولا توزيع بعدها من غير كود جديد.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.instapay_confirmation_window_hours', '24', 'number', 'payments', 'مدة صلاحية كود تحويل InstaPay قبل ما يتطلب إعادة الدفع من جديد (ساعات)', false)
ON CONFLICT (key) DO NOTHING;
