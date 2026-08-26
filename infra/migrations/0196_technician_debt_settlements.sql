-- ADR-0041 / docs/08 §63.أ2 — تسوية مديونية الفني للمنصة.
--
-- المشكلة: الفني بيبقى مديون فعليًا (أوضح حالة: طلب كاش، بيمسك عمولة المنصة معاه) والرصيد بيبقى
-- سالب — بس مفيش أي طريقة تسجّل إنه **دفع الفلوس دي برّه التطبيق**. الأدمن كان مضطر يستخدم
-- `PATCH /admin/wallets/:userId/adjust` الخام، فالحركة بتتسجّل كـ"تصحيح" بلا سبب تجاري ولا طريقة
-- دفع ولا مرجع — «الفلوس دول مفتوحة كده عنده في الظل» بنص المالك.
--
-- **مفيش دفتر ديون موازي**: الرصيد يفضل في `wallets.balance_cents` وبس. الجدول ده بيسجّل
-- **الواقعة** اللي المحفظة لوحدها ما تقدرش تعبّر عنها: رجعت إزاي، وامتى، ومين استلمها.

CREATE TABLE IF NOT EXISTS technician_debt_settlements (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id          uuid NOT NULL REFERENCES technician_profiles(id),
  amount_cents           integer NOT NULL CHECK (amount_cents > 0),
  -- إزاي الفني سدّد فعليًا برّه التطبيق
  method                 varchar(20) NOT NULL CHECK (method IN ('cash','instapay','bank_transfer')),
  -- رقم إيصال/تحويل — إثبات خارجي يربط الصف ده بواقعة حقيقية
  external_reference     varchar(120) NULL,
  note                   varchar(500) NULL,
  -- الرصيد قبل وبعد **وقت التسجيل** — snapshot عشان الصف يفضل مفهوم لوحده بعد سنين
  balance_before_cents   integer NOT NULL,
  balance_after_cents    integer NOT NULL,
  recorded_by_user_id    uuid NOT NULL REFERENCES users(id),
  -- القيد المزدوج اللي حرّك الرصيد فعليًا — الربط ده بيمنع أي انفصال بين السجل والمحفظة
  wallet_transaction_id  uuid NULL REFERENCES wallet_transactions(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_technician_debt_settlements_technician
  ON technician_debt_settlements (technician_id, created_at DESC);

COMMENT ON TABLE technician_debt_settlements IS
  'ADR-0041: واقعة سداد الفني لمديونيته برّه التطبيق. الرصيد نفسه يفضل في wallets — ده سجل مصاحب مش بديل.';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_debt_settlements
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- عتبات الإنذار — سياسة يغيّرها الأدمن، مش أرقام مدفونة في الكود.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('technician_debt.alert_threshold_cents', '50000', 'number', 'payments',
   'ADR-0041: مديونية الفني اللي فوقها تتحسب "تستاهل انتباه". بالقرش (50000 = 500 ج.م.).', false),
  ('technician_debt.alert_age_days', '14', 'number', 'payments',
   'ADR-0041: عدد أيام استمرار المديونية اللي بعدها تتحسب "قديمة". الحالة alert بتيجي لما العتبتين يتعدّوا مع بعض.', false)
ON CONFLICT (key) DO NOTHING;
