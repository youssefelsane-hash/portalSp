-- baytak — 0083: محرك الـKPI الشهري للفني + مكافأة الأداء (docs/11 §3، قرار عمل من المالك 2026-08-13)
-- المبدأ الحاكم: المنصة بتحسب وتعرض بيانات أداء موضوعية بس، الأدمن/العمليات هو اللي بيقرر
-- المبلغ النهائي جوّه حدود قابلة للإعداد بالكامل — مفيش قرار آلي نهائي على فلوس حقيقية.
-- كل الأبعاد والأوزان والعتبات هنا مبنية بس على بيانات مسجّلة فعلاً في المنصة (orders, ratings,
-- complaints, technician_order_cancellations, order_assignments, wallet_transactions) — صفر
-- بيانات مخترعة، مطابق تمامًا لقرار المالك الصريح.

CREATE TYPE kpi_snapshot_status AS ENUM ('calculated', 'approved', 'paid', 'rejected');

CREATE TABLE technician_kpi_snapshots (
  id                          UUID                 PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id               UUID                 NOT NULL REFERENCES technician_profiles(id),
  period_year                 SMALLINT             NOT NULL,
  period_month                SMALLINT             NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  -- ── بيانات خام (snapshot وقت الحساب — مصدرها بالتفصيل في README الموديول) ──
  offered_orders_count        INTEGER              NOT NULL DEFAULT 0,
  accepted_orders_count       INTEGER              NOT NULL DEFAULT 0,
  completed_orders_count      INTEGER              NOT NULL DEFAULT 0,
  technician_cancelled_count  INTEGER              NOT NULL DEFAULT 0,
  acceptance_rate             NUMERIC(5,2)         NULL,
  completion_rate             NUMERIC(5,2)         NULL,
  cancellation_rate           NUMERIC(5,2)         NULL,
  average_rating               NUMERIC(4,2)        NULL,
  ratings_count                INTEGER             NOT NULL DEFAULT 0,
  negative_ratings_count       INTEGER             NOT NULL DEFAULT 0,
  average_cleanliness_rating   NUMERIC(4,2)        NULL,
  complaints_count             INTEGER             NOT NULL DEFAULT 0,
  complaints_upheld_count      INTEGER             NOT NULL DEFAULT 0,
  serious_upheld_complaint     BOOLEAN             NOT NULL DEFAULT false,
  revisit_count                INTEGER             NOT NULL DEFAULT 0,
  platform_revenue_cents       BIGINT              NOT NULL DEFAULT 0,
  technician_earnings_cents    BIGINT              NOT NULL DEFAULT 0,
  order_value_cents            BIGINT              NOT NULL DEFAULT 0,

  -- ── التقييم والاقتراح ──
  is_eligible                  BOOLEAN             NOT NULL DEFAULT false,
  ineligibility_reason         TEXT                NULL,
  dimension_scores              JSONB              NOT NULL DEFAULT '{}',
  weights_applied               JSONB              NOT NULL DEFAULT '{}',
  overall_score                 NUMERIC(5,2)       NULL,
  suggested_bonus_cents         INTEGER            NULL,

  -- ── سير موافقة/صرف الأدمن — القرار النهائي دايمًا بشري ──
  status                        kpi_snapshot_status NOT NULL DEFAULT 'calculated',
  approved_bonus_cents           INTEGER            NULL,
  approved_by_user_id            UUID               NULL REFERENCES users(id),
  approved_at                    TIMESTAMPTZ        NULL,
  approval_notes                 TEXT               NULL,
  rejected_reason                TEXT               NULL,
  paid_at                        TIMESTAMPTZ        NULL,
  wallet_credit_tx_id            UUID               NULL,

  calculated_at                  TIMESTAMPTZ        NOT NULL DEFAULT now(),
  created_at                     TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ        NOT NULL DEFAULT now(),

  UNIQUE (technician_id, period_year, period_month)
);

CREATE INDEX idx_technician_kpi_snapshots_period ON technician_kpi_snapshots(period_year, period_month);
CREATE INDEX idx_technician_kpi_snapshots_technician ON technician_kpi_snapshots(technician_id);
CREATE INDEX idx_technician_kpi_snapshots_status ON technician_kpi_snapshots(status);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_kpi_snapshots
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE technician_kpi_snapshots IS 'سجل شهري ثابت (immutable بعد approved/paid) لأداء الفني — القيم الخام + الدرجات المحسوبة + قرار الأدمن. صف واحد لكل (فني، سنة، شهر).';
COMMENT ON COLUMN technician_kpi_snapshots.dimension_scores IS 'درجة كل بُعد من 0-100، مثال: {"rating": 82.5, "cancellation": 90, "complaints": 100, "acceptance": 75, "completion": 95, "revenue": 60} — بس الأبعاد اللي كان فيها بيانات كافية الشهر ده.';
COMMENT ON COLUMN technician_kpi_snapshots.weights_applied IS 'صورة من أوزان settings وقت الحساب (للتدقيق — لو الأدمن غيّر الأوزان بعدين، السجل التاريخي يفضل موضّح بالوزن اللي اتحسب بيه فعلاً).';
COMMENT ON COLUMN technician_kpi_snapshots.serious_upheld_complaint IS 'شكوى severity=critical اتحلّت resolved بـresolution_type != no_action الشهر ده — لو kpi.serious_complaint_zero_score مفعّلة، بتصفّر overall_score تلقائيًا.';

-- ── إعدادات محرك الـKPI — group_name='kpi'، كل قيمة قابلة للتعديل من /settings، صفر hardcoding ──
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('kpi.enabled', 'true', 'boolean', 'kpi', 'تفعيل/تعطيل محرك الـKPI الشهري بالكامل', false),
  ('kpi.monthly_max_bonus_cents', '500000', 'number', 'kpi', 'أقصى مكافأة شهرية للفني الواحد بالقرش (افتراضي 5000 جنيه) — الأدمن العادي مايقدرش يتخطاها', false),
  ('kpi.min_completed_jobs_for_eligibility', '3', 'number', 'kpi', 'أقل عدد طلبات مكتملة في الشهر عشان الفني يبقى مؤهّل لمكافأة مقترحة', false),
  ('kpi.weight_rating', '30', 'number', 'kpi', 'وزن بُعد متوسط التقييم', false),
  ('kpi.weight_cancellation', '15', 'number', 'kpi', 'وزن بُعد معدل الإلغاء من الفني (سلبي)', false),
  ('kpi.weight_complaints', '15', 'number', 'kpi', 'وزن بُعد الشكاوى المثبتة (سلبي)', false),
  ('kpi.weight_acceptance', '15', 'number', 'kpi', 'وزن بُعد معدل قبول عروض الطلبات', false),
  ('kpi.weight_completion', '15', 'number', 'kpi', 'وزن بُعد معدل إتمام الطلبات المقبولة', false),
  ('kpi.weight_revenue', '10', 'number', 'kpi', 'وزن بُعد الإيراد النسبي مقارنة بمتوسط الفنيين الشهر ده', false),
  ('kpi.negative_rating_threshold', '2', 'number', 'kpi', 'التقييم (من 5) اللي يساويه أو أقل منه يُحسب "تقييم سلبي"', false),
  ('kpi.penalty_points_per_upheld_complaint', '20', 'number', 'kpi', 'نقاط تُخصم من بُعد الشكاوى لكل شكوى مثبتة (upheld) الشهر ده', false),
  ('kpi.serious_complaint_zero_score', 'true', 'boolean', 'kpi', 'شكوى حرجة (critical) مثبتة تصفّر الـKPI الشهري بالكامل تلقائيًا', false),
  ('kpi.ops_can_override_suggested_amount', 'true', 'boolean', 'kpi', 'العمليات تقدر تعتمد مبلغ مختلف عن المقترح (جوّه الحدود) بدل ما تكون ملزمة بالرقم المقترح بالظبط', false),
  ('kpi.expose_approval_notes_to_technician', 'false', 'boolean', 'kpi', 'إظهار ملاحظات الأدمن الداخلية للفني في شاشة الـKPI بتاعته', false);

-- ── صلاحيات جديدة — نفس نمط 0040 (technicians.manage_zones) ──
INSERT INTO permissions (name, resource, action) VALUES
  ('technician_kpi.calculate', 'technician_kpi', 'calculate'),
  ('technician_kpi.approve', 'technician_kpi', 'approve'),
  ('technician_kpi.override_max', 'technician_kpi', 'override_max');

-- منح افتراضي لـops_manager/finance — super_admin بياخدها أوتوماتيك عن طريق is_super_admin bypass
-- (ADR-0010، مفيش حاجة نمنحها هنا صراحة). override_max بالذات مايتاخدش افتراضيًا لأي دور تاني —
-- نفس فلسفة roles.grant_unrestricted، Super Admin بس اللي يقدر يتخطى السقف الشهري.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('technician_kpi.calculate', 'technician_kpi.approve')
WHERE r.name IN ('ops_manager', 'finance');
