-- ADR-0040 / docs/08 §63.أ3 — توزيع مستحقات الشغلانة على الطاقم بوزن المستوى.
--
-- الفجوة اللي بتتقفل: settleAndComplete() كانت بتحوّل technician_earning_cents **بالكامل** لقائد
-- الطلب، وأعضاء order_team_members بياخدوا صفر (فجوة موثّقة صراحةً في technicians/README.md).

-- ١) وزن الحصة لكل مستوى — بينضم لخصائص المستوى الموجودة (order_priority_weight،
--    commission_adjustment_percentage) في نفس الجدول اللي الأدمن بيديره أصلاً، مش جدول جديد.
--    مقصود إنه **مش** نفس resolveLevelPriceMultiplier: ده مضاعف سعر للعميل لكل خدمة، وده حصة
--    داخلية بين ناس اشتغلوا مع بعض — مفهومين مختلفين، وخلطهم كان هيخلّي تسعير خدمة يحرّك
--    التوزيع بين العمّال بلا قرار من حد.
ALTER TABLE technician_level_config
  ADD COLUMN IF NOT EXISTS crew_share_weight numeric(5,2) NOT NULL DEFAULT 1.00
  CHECK (crew_share_weight > 0);

COMMENT ON COLUMN technician_level_config.crew_share_weight IS
  'ADR-0040: وزن حصة المستوى في توزيع مستحقات الشغلانة على الطاقم. نقطة بداية قابلة للتعديل من الأدمن.';

UPDATE technician_level_config SET crew_share_weight = 1.00 WHERE level = 'new'          AND crew_share_weight = 1.00;
UPDATE technician_level_config SET crew_share_weight = 1.10 WHERE level = 'verified'     AND crew_share_weight = 1.00;
UPDATE technician_level_config SET crew_share_weight = 1.25 WHERE level = 'professional' AND crew_share_weight = 1.00;
UPDATE technician_level_config SET crew_share_weight = 1.45 WHERE level = 'premium'      AND crew_share_weight = 1.00;
UPDATE technician_level_config SET crew_share_weight = 1.60 WHERE level = 'team_leader'  AND crew_share_weight = 1.00;

-- ٢) snapshot الحصص — بيتكتب مرة واحدة وقت التسوية. تغيير مستوى الفني بعدين ما يغيّرش حصة قديمة
--    (نفس فلسفة commissionable_base_cents وwarranty_plan_snapshot).
CREATE TABLE IF NOT EXISTS order_earning_shares (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id              uuid NOT NULL REFERENCES orders(id),
  technician_id         uuid NOT NULL REFERENCES technician_profiles(id),
  -- 'leader' = orders.technician_id، والباقي من order_team_members.member_type
  participant_role      varchar(20) NOT NULL CHECK (participant_role IN ('leader','team_member','assistant')),
  -- المستوى والوزن **وقت التنفيذ**، مش وقت القراءة — ده جوهر الـsnapshot.
  technician_level      technician_level NOT NULL,
  share_weight          numeric(5,2) NOT NULL CHECK (share_weight > 0),
  -- الوعاء اللي اتقسم (technician_earning_cents وقت التسوية) — متكرر في كل صف عمدًا عشان الصف
  -- يفضل مفهوم لوحده من غير join على orders.
  pool_cents            integer NOT NULL CHECK (pool_cents >= 0),
  share_cents           integer NOT NULL CHECK (share_cents >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz NULL,
  CONSTRAINT order_earning_shares_order_technician_key UNIQUE (order_id, technician_id)
);

CREATE INDEX IF NOT EXISTS idx_order_earning_shares_technician ON order_earning_shares (technician_id);
CREATE INDEX IF NOT EXISTS idx_order_earning_shares_order ON order_earning_shares (order_id);

COMMENT ON TABLE order_earning_shares IS
  'ADR-0040: نصيب كل مشارك من مستحقات الشغلانة. الطلبات المتسوّاة قبل الـmigration مالهاش صفوف هنا — غيابها معناه "القائد أخد الكل"، وده الواقع الفعلي وقتها.';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON order_earning_shares
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
