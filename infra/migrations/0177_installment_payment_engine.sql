-- baytak (صُنّاع) — 0177: محرك التقسيط/التقسيم المالي (Installment / Split-Payment)
--
-- مبادئ التصميم (راجع apps/api/src/modules/installments/README.md):
-- 1. التقسيط **مش نظام دفع موازي**: بيستخدم نفس PaymentProvider architecture (chargeToken
--    الموجود لشغل إضافي معتمد)، ونفس webhook pipeline (payments.installment_id فرع جديد)،
--    ونفس الـwallet double-entry ledger.
-- 2. التقديم = طلب مراجعة بشر، مش موافقة ذاتية — مفيش أي مسار يخلّي العميل يعتمد نفسه.
-- 3. كل المبالغ بالقرش integer، والحساب authoritative من الباك-إند حصريًا.
-- 4. الفصل الصريح: مستحق العميل (receivable) ≠ مدفوع العميل ≠ رصيد المنصة ≠ استحقاق
--    الفني/المزوّد (اللي فاضل زي ما هو على مستوى الطلب الحالي — قرار عمل موثق في README).

-- ============ 1) خطط التقسيط (كتالوج يديره الأدمن) ============
CREATE TABLE installment_plans (
  id                          UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  name_ar                     VARCHAR(120)   NOT NULL,
  -- عدد الأقساط الشهرية/الدورية (بدون المقدم) — قابل للتهيئة بالكامل، مفيش قيم hardcoded.
  installment_count           INTEGER        NOT NULL CHECK (installment_count >= 1 AND installment_count <= 60),
  -- الفاصل الزمني بين الأقساط بالأيام (30 = شهري تقريبًا؛ الأدمن يقدر يحط 7 أسبوعي مثلًا).
  interval_days               INTEGER        NOT NULL DEFAULT 30 CHECK (interval_days >= 1 AND interval_days <= 365),
  -- نسبة التمويل % من سعر الخدمة (0 = بلا تمويل). قد تكون كسور (12.5).
  financing_percentage        NUMERIC(5,2)   NOT NULL DEFAULT 0 CHECK (financing_percentage >= 0 AND financing_percentage <= 100),
  -- رسم تمويل ثابت بالقرش (اختياري فوق النسبة).
  fixed_fee_cents             INTEGER        NOT NULL DEFAULT 0 CHECK (fixed_fee_cents >= 0),
  -- نسبة المقدم % من الإجمالي الممول (0 = بلا مقدم).
  down_payment_percentage     NUMERIC(5,2)   NOT NULL DEFAULT 0 CHECK (down_payment_percentage >= 0 AND down_payment_percentage <= 100),
  -- حدود أهلية المبلغ (NULL = بلا حد).
  min_order_amount_cents      INTEGER        NULL CHECK (min_order_amount_cents IS NULL OR min_order_amount_cents > 0),
  max_order_amount_cents      INTEGER        NULL CHECK (max_order_amount_cents IS NULL OR max_order_amount_cents > 0),
  -- مفتاح provider من PaymentProviderRegistry المسموح للتحصيل التلقائي (paymob حاليًا —
  -- التحصيل يتوقف BLOCKED لو provider مايدعمش tokenization أو مش متظبط).
  allowed_provider            VARCHAR(40)    NOT NULL DEFAULT 'paymob',
  -- v1: المراجعة البشرية إجبارية معماريًا — العمود موجود للمستقبل بس الكود مايلتزمش بقيمة false.
  requires_admin_approval     BOOLEAN        NOT NULL DEFAULT true,
  -- التحصيل التلقائي محتاج وسيلة دفع محفوظة (tokenized) — بدونها الخطة تفضل مجدولة BLOCKED.
  requires_saved_card         BOOLEAN        NOT NULL DEFAULT true,
  is_active                   BOOLEAN        NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ    NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON installment_plans
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============ 2) ربط الخدمات بالخطط (استهداف الأدمن) ============
CREATE TABLE service_installment_plans (
  service_id   UUID NOT NULL REFERENCES services(id),
  plan_id      UUID NOT NULL REFERENCES installment_plans(id),
  PRIMARY KEY (service_id, plan_id)
);

-- ============ 3) المستندات المطلوبة لكل خطة (KYC-like configurable) ============
CREATE TABLE installment_plan_document_requirements (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  plan_id        UUID          NOT NULL REFERENCES installment_plans(id),
  -- نوع المستند كمفتاح حر يديره الأدمن ('national_id_front' مثلاً) — مش enum hardcoded.
  doc_type       VARCHAR(40)   NOT NULL,
  label_ar       VARCHAR(120)  NOT NULL,
  is_required    BOOLEAN       NOT NULL DEFAULT true,
  display_order  SMALLINT      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (plan_id, doc_type)
);

-- ============ 4) طلبات التقسيط (Application — مراجعة بشر قبل التفعيل) ============
CREATE TABLE installment_applications (
  id                        UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                  UUID           NOT NULL REFERENCES orders(id),
  customer_id               UUID           NOT NULL REFERENCES customer_profiles(id),
  plan_id                   UUID           NOT NULL REFERENCES installment_plans(id),
  -- pending_review → approved/rejected/cancelled. approved = العقد/الجدولة نشطة.
  status                    VARCHAR(20)    NOT NULL DEFAULT 'pending_review'
                            CHECK (status IN ('pending_review', 'approved', 'rejected', 'cancelled')),
  -- ===== Snapshot مالي authoritative (محسوب وقت التقديم من الخطة + سعر الطلب) — تغيير الخطة
  -- بعدين بيطبق prospectively على طلبات جديدة بس، ده snapshot تاريخي غير قابل للتعديل. =====
  service_price_cents       INTEGER        NOT NULL CHECK (service_price_cents > 0),
  financing_percentage      NUMERIC(5,2)   NOT NULL,
  fixed_fee_cents           INTEGER        NOT NULL,
  financing_fee_cents       INTEGER        NOT NULL CHECK (financing_fee_cents >= 0),
  total_financed_cents      INTEGER        NOT NULL CHECK (total_financed_cents > 0),
  down_payment_percentage   NUMERIC(5,2)   NOT NULL,
  down_payment_cents        INTEGER        NOT NULL CHECK (down_payment_cents >= 0),
  financed_balance_cents    INTEGER        NOT NULL CHECK (financed_balance_cents >= 0),
  installment_count         INTEGER        NOT NULL,
  regular_installment_cents INTEGER        NOT NULL CHECK (regular_installment_cents >= 0),
  final_installment_cents   INTEGER        NOT NULL CHECK (final_installment_cents > 0),
  interval_days             INTEGER        NOT NULL,
  first_due_at              TIMESTAMPTZ    NOT NULL,
  -- وسيلة الدفع المحفوظة المختارة للتحصيل التلقائي (tokenized — مفيش أي بيانات كارت خام هنا).
  payment_method_id         UUID           NULL REFERENCES payment_methods(id),
  allowed_provider          VARCHAR(40)    NOT NULL DEFAULT 'paymob',
  -- إثبات قبول الشروط (payment_policy_versions.id) — راجع جداول السياسات تحت.
  accepted_policy_version_id UUID          NULL,
  -- المراجعة البشرية
  rejection_reason          TEXT           NULL,
  review_notes              TEXT           NULL,
  reviewed_by               UUID           NULL REFERENCES users(id),
  reviewed_at               TIMESTAMPTZ    NULL,
  submitted_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
  activated_at              TIMESTAMPTZ    NULL,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ    NULL
);
-- طلب واحد ليه طلب تقسيط واحد نشط كحد أقصى (مرفوض/ملغي يسمح بإعادة تقديم).
CREATE UNIQUE INDEX uq_installment_applications_active_order
  ON installment_applications (order_id)
  WHERE status IN ('pending_review', 'approved') AND deleted_at IS NULL;
CREATE INDEX idx_installment_applications_status ON installment_applications (status, submitted_at);
CREATE INDEX idx_installment_applications_customer ON installment_applications (customer_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON installment_applications
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============ 5) جدولة الأقساط (بعد الموافقة فقط) ============
-- القسم رقم 0 = المقدم (لو موجود) — نموذج موحّد: sum(كل الصفوف المدفوعة) = مدفوع العميل،
-- وsum(كل الصفوف) = الإجمالي الممول. الثابت الحاكم مفروض بCHECK على مستوى التطبيق
-- (assertBreakdownInvariant) قبل الإنشاء.
CREATE TABLE installments (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  application_id   UUID         NOT NULL REFERENCES installment_applications(id),
  sequence_number  INTEGER      NOT NULL CHECK (sequence_number >= 0),
  due_at           TIMESTAMPTZ  NOT NULL,
  amount_cents     INTEGER      NOT NULL CHECK (amount_cents > 0),
  -- مصغّرة عمدًا: due/overdue مش حالات مخزنة (بتتحسب من due_at vs now) — الحالات المخزنة
  -- بس اللي بتغيرها عمليات فعلية. refunded بيظهر بس لو اترجع جزء محصل فعلاً.
  status           VARCHAR(12)  NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'processing', 'paid', 'failed', 'cancelled', 'refunded')),
  attempt_count    INTEGER      NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  payment_id       UUID         NULL, -- FK بيتضاف تحت بعد إنشاء payments.installment_id (ترتيب التنفيذ)
  paid_at          TIMESTAMPTZ  NULL,
  last_attempt_at  TIMESTAMPTZ  NULL,
  last_error       TEXT         NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (application_id, sequence_number)
);
CREATE INDEX idx_installments_schedule_claim ON installments (due_at) WHERE status IN ('scheduled', 'failed');
CREATE INDEX idx_installments_application ON installments (application_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON installments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============ 6) مستندات العميل المرفقة بالطلب (KYC-like) ============
-- نفس بنية technician_documents الآمنة: storage key خاص + MIME allowlist + magic bytes
-- (التحقق في السيرفس) + وصول مقيد بصلاحية أدمن مالية/KYC مع audit لكل فتح.
CREATE TABLE installment_application_documents (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  application_id  UUID          NOT NULL REFERENCES installment_applications(id),
  doc_type        VARCHAR(40)   NOT NULL,
  storage_key     TEXT          NOT NULL,
  mime_type       VARCHAR(80)   NOT NULL,
  file_size_bytes INTEGER       NOT NULL CHECK (file_size_bytes > 0),
  uploaded_by     UUID          NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ   NULL -- سياسة retention: حذف ناعم عند إغلاق/رفض الطلب أو بطلب العميل
);
CREATE INDEX idx_installment_docs_application ON installment_application_documents (application_id);

-- ============ 7) ربط الدفعات بالأقساط (فرع webhook الجديد) ============
ALTER TABLE payments ADD COLUMN installment_id UUID NULL;
ALTER TABLE payments ADD CONSTRAINT fk_payments_installment
  FOREIGN KEY (installment_id) REFERENCES installments(id);
ALTER TABLE installments ADD CONSTRAINT fk_installments_payment
  FOREIGN KEY (payment_id) REFERENCES payments(id);

-- نوع قيد جديد لدفتر القيود: تحصيل قسط ناجح (عميل → منصة) — نفس الـdouble-entry الموجود
-- بالحرف، النوع الجديد بس عشان التقارير تقدر تفصل إيراد التقسيط عن باقي الأنواع.
ALTER TYPE wallet_tx_type ADD VALUE IF NOT EXISTS 'installment_collection' AFTER 'referral_reward';

-- ============ 8) صلاحيات جديدة (نفس نمط 0099/0104) ============
INSERT INTO permissions (name, resource, action) VALUES
  ('installments.view',   'installments', 'view'),
  ('installments.review', 'installments', 'review'),
  ('installments.manage', 'installments', 'manage'),
  ('payment_policies.manage', 'payment_policies', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN ('installments.view', 'installments.review')
WHERE r.name = 'finance';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN (
  'installments.view', 'installments.review', 'installments.manage', 'payment_policies.manage'
)
WHERE r.name = 'super_admin';

-- ============ 9) إعدادات التشغيل (defaults آمنة — التحصيل التلقائي مطفأ لحد تأكيد
-- قدرة provider على recurring charges فعليًا ضد البوابة الحقيقية) ============
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('installments.auto_collection_enabled', 'false', 'boolean', 'installments',
   'تشغيل التحصيل التلقائي للأقساط المستحقة بوسائل الدفع المحفوظة — لا يُفعّل إلا بعد التحقق من دعم البوابة للتحصيل المتكرر فعليًا', false),
  ('installments.retry_backoff_days', '3', 'number', 'installments',
   'عدد الأيام بين محاولات إعادة تحصيل القسط الفاشل', false),
  ('installments.max_auto_attempts', '3', 'number', 'installments',
   'أقصى عدد محاولات تحصيل تلقائية لكل قسط — بعدها يفضل overdue مرئي للتدخل اليدوي', false)
ON CONFLICT (key) DO NOTHING;

-- ============ 10) سياسات الدفع/الشروط (versioned consent) ============
-- النسخ immutable: تعديل النص = نشر نسخة جديدة، والقبول بيرتبط بنسخة محددة + سياق.
CREATE TABLE payment_policies (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug               VARCHAR(60)  NOT NULL UNIQUE,
  title_ar           VARCHAR(200) NOT NULL,
  -- installment / postpaid_service / deposit / manual_transfer / general
  applies_to         VARCHAR(30)  NOT NULL,
  target_service_id  UUID         NULL REFERENCES services(id),
  target_category_id UUID         NULL REFERENCES service_categories(id),
  is_required        BOOLEAN      NOT NULL DEFAULT true,
  is_active          BOOLEAN      NOT NULL DEFAULT true,
  display_order      SMALLINT     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON payment_policies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE payment_policy_versions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  policy_id    UUID        NOT NULL REFERENCES payment_policies(id),
  version      INTEGER     NOT NULL CHECK (version >= 1),
  body_ar      TEXT        NOT NULL CHECK (length(body_ar) >= 20),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

CREATE TABLE payment_policy_acceptances (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  policy_version_id UUID        NOT NULL REFERENCES payment_policy_versions(id),
  user_id           UUID        NOT NULL REFERENCES users(id),
  context_type      VARCHAR(30) NOT NULL, -- 'order' | 'installment_application'
  context_id        UUID        NOT NULL,
  accepted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_policy_acceptances_user ON payment_policy_acceptances (user_id);
CREATE INDEX idx_policy_acceptances_context ON payment_policy_acceptances (context_type, context_id);

-- ============ 11) قواعد توجيه إشعارات العمليات (نفس نمط 0103/0137) ============
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('installment.application_submitted', 'finance',   '["in_app"]'),
  ('installment.payment_failed',        'finance',   '["in_app"]'),
  ('installment.overdue_escalation',    'finance',   '["in_app"]')
ON CONFLICT DO NOTHING;
