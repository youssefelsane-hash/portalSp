-- baytak — 0028: إعدادات كل مستوى فني (نقطة 4) — قابلة للتعديل بالكامل من لوحة الإدارة بدون كود.
-- منفصلة عن 0027 عمداً — استخدام قيمة enum جديدة ('team_leader') لازم يكون بعد commit للـ
-- ALTER TYPE ADD VALUE اللي زرعها.
--
-- commission_adjustment_percentage: فرق (سالب/موجب) بيتحسب على عمولة الخدمة الأساسية
-- (services.commission_percentage) — مستوى أعلى = عمولة منصة أقل، حافز جودة حقيقي.
-- order_priority_weight: وزن ترتيب الإرسال جوّه دائرة الفنيين المؤهلين (مش بديل عن المسافة، إضافة ليها).
-- decision_limit_cents: أعلى قيمة طلب الفني يقدر يقبلها لوحده من غير مراجعة إدارية — NULL = بلا حد.
-- can_lead_team: بس المستويات دي تقدر تنشئ/تدير شركة فنيين (technician_companies).

-- id UUID منفصل عن level (بدل ما يكون level نفسه الـ PK) عشان يتسجل كـ entity_id في audit_logs
-- (عمود UUID صارم) — نفس اتفاقية كل جدول تاني في السكيما.
CREATE TABLE technician_level_config (
  id                                  UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  level                               technician_level  NOT NULL UNIQUE,
  display_name_ar                    VARCHAR(60)       NOT NULL,
  commission_adjustment_percentage   NUMERIC(5,2)      NOT NULL DEFAULT 0,
  order_priority_weight              SMALLINT          NOT NULL DEFAULT 0,
  decision_limit_cents               INTEGER           NULL,
  can_lead_team                      BOOLEAN           NOT NULL DEFAULT false,
  updated_at                         TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_level_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO technician_level_config
  (level, display_name_ar, commission_adjustment_percentage, order_priority_weight, decision_limit_cents, can_lead_team)
VALUES
  ('new',          'جديد',       0.00,  0,  20000,  false),
  ('verified',     'موثّق',      -1.00, 10,  50000,  false),
  ('professional', 'محترف',      -2.00, 20, 150000,  false),
  ('premium',      'بريميوم',    -3.00, 30, NULL,    true),
  ('team_leader',  'قائد فريق',  -3.00, 40, NULL,    true);
