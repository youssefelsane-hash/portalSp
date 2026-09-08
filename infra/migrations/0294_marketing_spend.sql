-- baytak — 0294: إنفاق التسويق (ADR-0081 §6)
--
-- CAC (تكلفة اكتساب العميل) هو المقياس الوحيد في لوحة الإدارة اللي **مايتحسبش** من بيانات
-- النظام: الفلوس المدفوعة على الإعلانات مش عايشة في أي جدول عندنا. الاختيارين كانوا:
--   1. نعرضه صفر أو نخفيه — والصفر هنا **كذب** (بيقول اكتساب العميل مجاني).
--   2. الأدمن يدخّل الإنفاق الشهري، والنظام يقسّمه على العملاء الجداد الحقيقيين.
-- اخترنا التاني. لو مفيش إنفاق مسجّل للفترة، الـAPI بترجّع `null` صراحةً مش صفر.
--
-- الحبيبة شهر × قناة: أدق تقسيم مفيد فعلاً (فيسبوك اتكلّف كام مقابل جوجل)، ومن غير ما
-- نطلب من الأدمن إدخال يومي مستحيل يتصان.

CREATE TABLE marketing_spend (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- أول يوم في الشهر (UTC). الشهر كوحدة مش تاريخ حر — عشان مايبقاش فيه فترات متداخلة
  -- بتتحسب مرتين في نفس الـCAC.
  month           DATE          NOT NULL,
  channel         VARCHAR(40)   NOT NULL,
  amount_cents    INTEGER       NOT NULL,
  notes           TEXT          NULL,

  recorded_by_user_id UUID      NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ   NULL,

  CONSTRAINT chk_marketing_spend_amount_positive CHECK (amount_cents >= 0),
  -- أول الشهر بالظبط — بيمنع «2026-09-14» اللي بيخلّي نفس الشهر ليه صفين مختلفين.
  CONSTRAINT chk_marketing_spend_month_first_day CHECK (EXTRACT(DAY FROM month) = 1)
);

-- صف واحد لكل (شهر، قناة) — التعديل بيبقى UPDATE مش إدخال تاني بيتجمع عليه.
CREATE UNIQUE INDEX uq_marketing_spend_month_channel ON marketing_spend(month, channel)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_marketing_spend_month ON marketing_spend(month);
CREATE INDEX idx_marketing_spend_recorded_by_user_id ON marketing_spend(recorded_by_user_id)
  WHERE recorded_by_user_id IS NOT NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON marketing_spend
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- إدخال/تعديل إنفاق التسويق = كتابة مالية، فليها صلاحية كتابة منفصلة عن قراءة اللوحة.
INSERT INTO permissions (name, resource, action) VALUES
  ('analytics.marketing_spend.manage', 'analytics', 'marketing_spend_manage')
ON CONFLICT (name) DO NOTHING;

-- مين بيشوف الأرقام المالية بياخد حق إدخال الإنفاق كمان — مشتقّ من البيانات مش من قايمة
-- أدوار مكتوبة بالإيد (نفس أسلوب 0293).
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'analytics.financial.view'
JOIN permissions target ON target.name = 'analytics.marketing_spend.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
