-- baytak (صُنّاع) — 0178: نظام المشروعات والضمانات
-- Project Engine + Quote Versions + Milestones + Warranty Plans/Claims
--
-- مبادئ التصميم:
-- - المشروع **منسّق** مش بديل للطلبات — الطلبات العادية بتعمل تحت المشروع زي ما هي.
-- - كل المبالغ بالقرش integer، الحساب من السيرفر حصريًا.
-- - Quote Versions immutable بعد الإرسال — التعديل = نسخة جديدة.
-- - الضمان Product قابل للتسعير — Policy Snapshot غير قابل للتعديل بعد الشراء.

CREATE TYPE project_type AS ENUM ('finishing', 'renovation', 'move_in', 'multi_service', 'other');
CREATE TYPE project_status AS ENUM (
  'draft', 'survey_requested', 'survey_scheduled', 'quote_preparing',
  'awaiting_customer_approval', 'awaiting_deposit', 'active', 'paused',
  'awaiting_milestone_approval', 'handover_pending', 'completed',
  'cancelled', 'disputed'
);

-- ═══════════════════ 1) المشروع (Parent Entity) ═══════════════════
CREATE TABLE projects (
  id                          UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_number              VARCHAR(24)    NOT NULL UNIQUE,
  customer_id                 UUID           NOT NULL REFERENCES customer_profiles(id),
  address_id                  UUID           NOT NULL REFERENCES addresses(id),
  city_id                     UUID           REFERENCES cities(id),
  project_type                project_type   NOT NULL DEFAULT 'other',
  name_ar                     VARCHAR(200)   NOT NULL,
  description_ar              TEXT           NULL,
  status                      project_status NOT NULL DEFAULT 'draft',
  -- ميزانية
  budget_estimate_cents       INTEGER        NULL CHECK (budget_estimate_cents IS NULL OR budget_estimate_cents > 0),
  approved_quote_total_cents  INTEGER        NULL CHECK (approved_quote_total_cents IS NULL OR approved_quote_total_cents >= 0),
  total_work_value_cents      INTEGER        NOT NULL DEFAULT 0,
  total_materials_value_cents INTEGER        NOT NULL DEFAULT 0,
  warranty_paid_cents         INTEGER        NOT NULL DEFAULT 0,
  paid_cents                  INTEGER        NOT NULL DEFAULT 0,
  retained_cents              INTEGER        NOT NULL DEFAULT 0,
  released_cents              INTEGER        NOT NULL DEFAULT 0,
  remaining_cents             INTEGER        NOT NULL DEFAULT 0,
  -- الشركة/الفريق المسؤول عند التعيين
  assigned_company_id         UUID           NULL REFERENCES technician_companies(id),
  -- التواريخ
  survey_requested_at         TIMESTAMPTZ    NULL,
  survey_scheduled_at         TIMESTAMPTZ    NULL,
  expected_start              DATE           NULL,
  expected_end                DATE           NULL,
  actual_start                DATE           NULL,
  actual_end                  DATE           NULL,
  -- إلغاء / إيقاف / نزاع
  paused_reason               TEXT           NULL,
  cancelled_reason            TEXT           NULL,
  dispute_reason              TEXT           NULL,
  created_at                  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ    NULL
);
CREATE INDEX idx_projects_customer ON projects(customer_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ربط الطلبات بالمشروع (many-to-many: طلب واحد ممكن يخدم مشروع واحد فقط)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id) WHERE project_id IS NOT NULL;

-- مرفقات المشروع (صور/فيديو)
CREATE TABLE project_attachments (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id  UUID         NOT NULL REFERENCES projects(id),
  storage_key TEXT         NOT NULL,
  mime_type   VARCHAR(80)  NOT NULL,
  uploaded_by UUID         NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ═══════════════════ 2) عروض الأسعار (Versioned, Immutable after sent) ═══════════════════
CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'approved', 'rejected', 'expired', 'superseded');

CREATE TABLE project_quotes (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id            UUID          NOT NULL REFERENCES projects(id),
  version               INTEGER       NOT NULL DEFAULT 1,
  status                quote_status  NOT NULL DEFAULT 'draft',
  -- بنود العمل والمواد مجمعة هنا (JSONB — الأدمن يبنيها من الواجهة، القيم بالقرش)
  work_lines            JSONB         NOT NULL DEFAULT '[]',
  material_lines        JSONB         NOT NULL DEFAULT '[]',
  -- مجاميع محسوبة من السيرفر (authoritative snapshot)
  total_work_cents      INTEGER       NOT NULL DEFAULT 0 CHECK (total_work_cents >= 0),
  total_materials_cents INTEGER       NOT NULL DEFAULT 0 CHECK (total_materials_cents >= 0),
  discount_cents        INTEGER       NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents           INTEGER       NOT NULL CHECK (total_cents > 0),
  duration_days         INTEGER       NULL,
  scope_included        TEXT          NULL,
  scope_excluded        TEXT          NULL,
  assumptions           TEXT          NULL,
  proposed_company_id   UUID          NULL REFERENCES technician_companies(id),
  expires_at            TIMESTAMPTZ   NULL,
  sent_at               TIMESTAMPTZ   NULL,
  approved_at           TIMESTAMPTZ   NULL,
  rejected_reason       TEXT          NULL,
  created_by            UUID          NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_quotes_project ON project_quotes(project_id);
-- نسخة واحدة sent/approved لكل مشروع في نفس الوقت
CREATE UNIQUE INDEX uq_project_quotes_active ON project_quotes(project_id)
  WHERE status IN ('sent', 'approved');

-- ═══════════════════ 3) مراحل المشروع ═══════════════════
CREATE TYPE milestone_status AS ENUM ('pending', 'in_progress', 'completed', 'approved', 'rejected');
CREATE TYPE milestone_payment_status AS ENUM ('unpaid', 'pending_payment', 'paid');
CREATE TYPE milestone_payout_status AS ENUM ('held', 'released');

CREATE TABLE project_milestones (
  id                    UUID                     PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id            UUID                     NOT NULL REFERENCES projects(id),
  sequence_number       INTEGER                  NOT NULL,
  name_ar               VARCHAR(200)             NOT NULL,
  description_ar        TEXT                     NULL,
  amount_cents          INTEGER                  NOT NULL CHECK (amount_cents > 0),
  is_down_payment       BOOLEAN                  NOT NULL DEFAULT false,
  expected_date         DATE                     NULL,
  completion_criteria   TEXT                     NULL,
  execution_status      milestone_status         NOT NULL DEFAULT 'pending',
  approval_status       milestone_status         NOT NULL DEFAULT 'pending',
  payment_status        milestone_payment_status NOT NULL DEFAULT 'unpaid',
  payout_status         milestone_payout_status  NOT NULL DEFAULT 'held',
  proof_attachments     JSONB                    NOT NULL DEFAULT '[]',
  rejection_reason      TEXT                     NULL,
  approved_by_customer  BOOLEAN                  NULL,
  approved_at           TIMESTAMPTZ              NULL,
  paid_at               TIMESTAMPTZ              NULL,
  payout_released_at    TIMESTAMPTZ              NULL,
  created_at            TIMESTAMPTZ              NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ              NOT NULL DEFAULT now(),
  UNIQUE (project_id, sequence_number)
);
CREATE INDEX idx_milestones_project ON project_milestones(project_id);
CREATE INDEX idx_milestones_payout ON project_milestones(payout_status) WHERE payout_status = 'held';
CREATE TRIGGER set_updated_at BEFORE UPDATE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══════════════════ 4) خطط الضمان (Warranty Plans — Product) ═══════════════════
CREATE TABLE warranty_plans (
  id                    UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug                  VARCHAR(60)    NOT NULL UNIQUE,
  name_ar               VARCHAR(200)   NOT NULL,
  warranty_type         VARCHAR(40)    NOT NULL DEFAULT 'extended_workmanship'
                        CHECK (warranty_type IN ('workmanship', 'extended_workmanship')),
  -- الاستهداف
  target_service_id     UUID           NULL REFERENCES services(id),
  target_category_id    UUID           NULL REFERENCES service_categories(id),
  target_project_type   project_type   NULL,
  -- التسعير
  pricing_model         VARCHAR(20)    NOT NULL DEFAULT 'fixed' CHECK (pricing_model IN ('fixed','percentage')),
  price_value           NUMERIC(10,2)  NOT NULL DEFAULT 0 CHECK (price_value >= 0),
  -- التغطية
  coverage_months       INTEGER        NOT NULL CHECK (coverage_months >= 1 AND coverage_months <= 120),
  max_coverage_cents    INTEGER        NULL CHECK (max_coverage_cents IS NULL OR max_coverage_cents > 0),
  max_claims            INTEGER        NOT NULL DEFAULT 1 CHECK (max_claims >= 1),
  terms_ar              TEXT           NULL,
  exclusions_ar         TEXT           NULL,
  sla_ack_hours         INTEGER        NOT NULL DEFAULT 48,
  sla_inspection_hours  INTEGER        NOT NULL DEFAULT 72,
  sla_repair_start_hrs  INTEGER        NOT NULL DEFAULT 168,
  sla_repair_done_hrs   INTEGER        NOT NULL DEFAULT 336,
  liability_bearer      VARCHAR(20)    NOT NULL DEFAULT 'provider' CHECK (liability_bearer IN ('provider','platform')),
  is_active             BOOLEAN        NOT NULL DEFAULT true,
  version               INTEGER        NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON warranty_plans
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══════════════════ 5) ضمانات العملاء (Immutable Snapshot) ═══════════════════
CREATE TABLE customer_warranties (
  id                    UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  plan_id               UUID         NOT NULL REFERENCES warranty_plans(id),
  plan_version          INTEGER      NOT NULL,
  order_id              UUID         NULL REFERENCES orders(id),
  project_id            UUID         NULL REFERENCES projects(id),
  customer_id           UUID         NOT NULL REFERENCES customer_profiles(id),
  -- Snapshot غير قابل للتعديل
  name_ar               VARCHAR(200) NOT NULL,
  warranty_type         VARCHAR(40)  NOT NULL,
  price_paid_cents      INTEGER      NOT NULL CHECK (price_paid_cents >= 0),
  coverage_months       INTEGER      NOT NULL,
  max_coverage_cents    INTEGER      NULL,
  max_claims            INTEGER      NOT NULL,
  terms_ar              TEXT         NULL,
  exclusions_ar         TEXT         NULL,
  starts_at             TIMESTAMPTZ  NULL,
  expires_at            TIMESTAMPTZ  NOT NULL,
  claims_used           INTEGER      NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_warranties_customer ON customer_warranties(customer_id);

-- ═══════════════════ 6) مطالبات الضمان ═══════════════════
CREATE TYPE claim_status AS ENUM (
  'open', 'under_review', 'inspection_scheduled', 'approved',
  'rejected', 'repair_in_progress', 'resolved', 'closed'
);

CREATE TABLE warranty_claims (
  id                    UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  warranty_id           UUID         NOT NULL REFERENCES customer_warranties(id),
  order_id              UUID         NULL REFERENCES orders(id),
  project_id            UUID         NULL REFERENCES projects(id),
  customer_id           UUID         NOT NULL REFERENCES customer_profiles(id),
  status                claim_status NOT NULL DEFAULT 'open',
  defect_description    TEXT         NOT NULL,
  defect_discovered_at  DATE         NULL,
  attachments           JSONB        NOT NULL DEFAULT '[]',
  resolution_notes      TEXT         NULL,
  rejection_reason      TEXT         NULL,
  repair_order_id       UUID         NULL REFERENCES orders(id),
  original_provider_id  UUID         NULL REFERENCES technician_profiles(id),
  provider_deadline     TIMESTAMPTZ  NULL,
  resolved_at           TIMESTAMPTZ  NULL,
  closed_at             TIMESTAMPTZ  NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_warranty_claims_warranty ON warranty_claims(warranty_id);
CREATE INDEX idx_warranty_claims_status ON warranty_claims(status);

-- ═══════════════════ 7) صلاحيات ═══════════════════
INSERT INTO permissions (name, resource, action) VALUES
  ('projects.view',   'projects',   'view'),
  ('projects.manage', 'projects',   'manage'),
  ('warranty.view',   'warranty',   'view'),
  ('warranty.review', 'warranty',   'review'),
  ('warranty.manage', 'warranty',   'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN ('projects.view','projects.manage')
WHERE r.name = 'super_admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN ('warranty.view','warranty.review')
WHERE r.name = 'finance';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN ('warranty.view','warranty.review','warranty.manage')
WHERE r.name = 'super_admin';

-- ═══════════════════ 8) إعدادات ═══════════════════
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('projects.quote_expiry_days', '14', 'number', 'projects', 'عدد أيام صلاحية عرض السعر قبل ما ينتهي', false),
  ('projects.warranty_holdback_percentage', '5', 'number', 'projects', 'نسبة الاحتجاز من كل دفعة مرحلة لضمان الضمان', false),
  ('projects.milestone_auto_approve_hours', '72', 'number', 'projects', 'ساعات الموافقة التلقائية للمرحلة إذا العميل ما ردش', false)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════ 9) توجيه الإشعارات ═══════════════════
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('project.survey_requested',   'ops_manager', '["in_app"]'),
  ('project.quote_ready',        'ops_manager', '["in_app"]'),
  ('project.claim_filed',        'finance',     '["in_app"]')
ON CONFLICT DO NOTHING;
