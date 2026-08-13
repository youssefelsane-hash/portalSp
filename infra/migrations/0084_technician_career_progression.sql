-- baytak — 0084: محرك المسار الوظيفي/الترقي للفني (docs/11 §4، قرار عمل من المالك 2026-08-13)
-- بيعيد استخدام سُلّم المستويات الموجود بالفعل (technician_level enum: new→verified→professional→
-- premium→team_leader، technician_profiles.current_level، technician_level_history) بدل ما يخترع
-- سُلّم جديد — technician_level_config الموجود لسه بيتحكم في "مزايا" كل مستوى (عمولة/أولوية)، الجدول
-- الجديد هنا بيتحكم في "شروط الوصول" لكل مستوى (مفهوم مختلف تمامًا، مفيش تكرار).
-- مفيش أي عتبة ترقية مكتوبة في الكود — كل حاجة هنا صف قابل للتعديل الكامل من الأدمن.

CREATE TABLE technician_progression_rules (
  id                                  UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  from_level                          technician_level NOT NULL UNIQUE,
  to_level                            technician_level NOT NULL,
  enabled                             BOOLEAN        NOT NULL DEFAULT true,
  auto_promote                        BOOLEAN        NOT NULL DEFAULT false,
  min_completed_orders                INTEGER        NOT NULL DEFAULT 0,
  min_platform_revenue_cents          BIGINT         NOT NULL DEFAULT 0,
  min_avg_rating                      NUMERIC(3,2)   NULL,
  max_cancellation_rate               NUMERIC(5,2)   NULL,
  max_upheld_complaints               INTEGER        NULL,
  min_avg_kpi_score                   NUMERIC(5,2)   NULL,
  min_kpi_months_count                SMALLINT       NOT NULL DEFAULT 1,
  min_days_active                     INTEGER        NOT NULL DEFAULT 0,
  enable_demotion_review              BOOLEAN        NOT NULL DEFAULT false,
  demotion_review_max_cancellation_rate NUMERIC(5,2) NULL,
  demotion_review_min_avg_rating      NUMERIC(3,2)   NULL,
  demotion_review_max_upheld_complaints INTEGER      NULL,
  created_at                          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_progression_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE technician_progression_rules IS 'شروط الترقية بين مستويات الفني — منفصل عمدًا عن technician_level_config (ده مزايا المستوى، ده شروط الوصول له). صف واحد لكل مستوى مصدر (from_level UNIQUE).';
COMMENT ON COLUMN technician_progression_rules.auto_promote IS 'لو true، الترقية بتتنفّذ آليًا لحظة تحقق الشروط بلا تدخل أدمن. الافتراضي false — موافقة أدمن مطلوبة دايمًا إلا لو Super Admin فعّلها صراحة لانتقال معيّن.';
COMMENT ON COLUMN technician_progression_rules.min_avg_kpi_score IS 'NULL = مش شرط. لو محدّدة، لازم متوسط overall_score من آخر min_kpi_months_count سنابشوت KPI approved/paid يوصلها.';
COMMENT ON COLUMN technician_progression_rules.enable_demotion_review IS 'لو true، أي فني على to_level ده تدهور أداءه تحت العتبات دي بيتعلّم needs_demotion_review — التخفيض الفعلي لسه يدوي عبر PATCH /admin/technicians/:id/level الموجود أصلاً (مفيش تكرار).';

CREATE TABLE technician_progression_status (
  id                        UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id             UUID           NOT NULL UNIQUE REFERENCES technician_profiles(id),
  current_level             technician_level NOT NULL,
  next_level                technician_level NULL,
  is_eligible               BOOLEAN        NOT NULL DEFAULT false,
  unmet_requirements        JSONB          NOT NULL DEFAULT '[]',
  progress                  JSONB          NOT NULL DEFAULT '{}',
  eligible_since            TIMESTAMPTZ    NULL,
  needs_demotion_review     BOOLEAN        NOT NULL DEFAULT false,
  demotion_review_reason    TEXT           NULL,
  admin_decision            VARCHAR(20)    NULL CHECK (admin_decision IN ('approved', 'rejected')),
  admin_decision_by_user_id UUID           NULL REFERENCES users(id),
  admin_decision_at         TIMESTAMPTZ    NULL,
  admin_decision_reason     TEXT           NULL,
  last_evaluated_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_technician_progression_status_eligible ON technician_progression_status(is_eligible);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_progression_status
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE technician_progression_status IS 'الحالة الحيّة الحالية لكل فني تجاه المستوى الجاي — صف واحد لكل فني، بيتحدّث في كل تشغيل للمحرك (مش سنابشوت شهري زي KPI).';
COMMENT ON COLUMN technician_progression_status.eligible_since IS 'تاريخ أول لحظة بقى فيها مؤهّل بشكل مستمر — بيتصفّر لو الأهلية اتفقدت وبعدين رجعت (سلسلة أهلية جديدة).';
COMMENT ON COLUMN technician_progression_status.admin_decision IS 'قرار الأدمن الأخير على الأهلية المحسوبة الحالية — مش قفل نهائي، لو رفض والفني لسه مؤهّل في التشغيل الجاي هيفضل ظاهر برضه (نفس فلسفة KPI rejected).';

-- ── سُلّم افتراضي معقول — قابل للتعديل الكامل من الأدمن، مش نهائي ──
INSERT INTO technician_progression_rules
  (from_level, to_level, min_completed_orders, min_platform_revenue_cents, min_avg_rating, max_cancellation_rate, max_upheld_complaints, min_days_active)
VALUES
  ('new', 'verified', 10, 50000, 3.50, 20.00, 2, 14),
  ('verified', 'professional', 40, 300000, 4.00, 15.00, 1, 60),
  ('professional', 'premium', 100, 1000000, 4.30, 10.00, 1, 180),
  ('premium', 'team_leader', 200, 2500000, 4.50, 5.00, 0, 365);

-- ── صلاحيات جديدة ──
INSERT INTO permissions (name, resource, action) VALUES
  ('technician_progression.manage_rules', 'technician_progression', 'manage_rules'),
  ('technician_progression.approve', 'technician_progression', 'approve'),
  ('technician_progression.override', 'technician_progression', 'override');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('technician_progression.manage_rules', 'technician_progression.approve')
WHERE r.name IN ('ops_manager');
