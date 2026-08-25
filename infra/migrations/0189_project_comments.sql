-- baytak — 0189: كومنتات المشروع/المرحلة (ADR-0036، docs/08 §57 بند 3).
-- طلب المالك: "يبقى في كل فيز معاها مساحة كومنتات… الكومنت ده بيظهر للعميل كمان عشان يبقى
-- العميل متابع معانا كل حاجة عن طريق الأبليكيشن، مش لازم كل الكونتنت يبقى واتساب."
--
-- جدول واحد بنطاقين: milestone_id موجود = كومنت على مرحلة، NULL = كومنت عام على المشروع.
-- جدولين منفصلين كانوا هيكرروا كل منطق المرئية والصلاحيات مرتين بلا داعي — نفس الكيان بالظبط.
--
-- صفر تعديل على project_milestones: كل الأعمدة المطلوبة للتسليم مرحلة-مرحلة (amount_cents،
-- execution_status، approval_status، payment_status، payout_status، proof_attachments) موجودة
-- بالفعل من قبل كده — الناقص كان الـendpoints اللي تحرّكها، مش الـschema.

CREATE TABLE project_comments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- NULL = كومنت عام على المشروع كله.
  milestone_id  UUID REFERENCES project_milestones(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id),
  author_role   VARCHAR(20) NOT NULL,
  body          TEXT NOT NULL,
  -- الافتراضي مرئي: ده الاستخدام الأساسي اللي المالك طلبه. الإخفاء قرار واعٍ من الأدمن لملاحظة
  -- داخلية. كومنت العميل بيتفرض مرئي دايمًا في طبقة الخدمة (مالوش معنى يخفي عن نفسه).
  is_visible_to_customer BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT chk_project_comments_body_not_blank CHECK (length(btrim(body)) > 0)
);

-- المسار الساخن: كل كومنتات مشروع مرتّبة زمنيًا (شاشة غرفة المشروع بتقراها كل فتحة).
CREATE INDEX idx_project_comments_project ON project_comments (project_id, created_at)
  WHERE deleted_at IS NULL;
-- تجميع كومنتات مرحلة بعينها جوّه الكارت بتاعها.
CREATE INDEX idx_project_comments_milestone ON project_comments (milestone_id, created_at)
  WHERE milestone_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE project_comments IS
  'كومنتات المشروع/المرحلة (ADR-0036) — milestone_id NULL = كومنت عام على المشروع.';
