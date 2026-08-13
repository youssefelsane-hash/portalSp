-- baytak — 0072: قاعدة بيانات "الأكاديمية" (base schema بس، مش نظام تدريب كامل)
--
-- سياق: docs/01-master-plan.md §9.1 بيذكر "اجتياز اختبار الأكاديمية" كشرط من شروط الوصول لمستوى
-- Platinum، و§9.3 بيذكر "تدريب سلوكي يوم واحد" ضمن مسار قبول الفني. ده مش بند من قايمة الـ44 بند
-- (docs/10) ولا من الميزات المؤجّلة رسميًا (Favorites/تفضيلات الإشعارات/إلخ) — طلب صاحب المشروع
-- نفسه صراحة إن الموضوع ده يتعمله base بس دلوقتي وميتاخدش تركيز، على إن يتوسّع لاحقًا.
--
-- **الجدولين دول قاعدة بيانات فاضية للتسجيل بس — مفيش أي ربط تلقائي بمنطق الترقية/quality_score
-- الموجود في technicians module، ومفيش أي واجهة (أدمن/فني) بتستخدمهم لسه.** ده قرار عمدي: ربط
-- اجتياز الأكاديمية بمنطق الترقية الفعلي قرار عمل (هل هو شرط صارم؟ نافذة صلاحية؟ يُعاد الاختبار كل
-- قد إيه؟) مش موجود بالتفصيل الكافي في القاموس، فمش هنخترعه — نفس مبدأ باقي "الفجوات الموثّقة صراحة،
-- مش سهو" في المشروع ده. تفاصيل كاملة في apps/api/src/modules/academy/README.md.

CREATE TABLE academy_courses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title_ar       VARCHAR(200) NOT NULL,
  title_en       VARCHAR(200) NOT NULL,
  description_ar TEXT,
  passing_score  SMALLINT NOT NULL DEFAULT 70,
  display_order  SMALLINT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX idx_academy_courses_active ON academy_courses (is_active) WHERE deleted_at IS NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON academy_courses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- محاولة اختبار واحدة مسجَّلة يدويًا من الأدمن (مفيش محرك اختبارات تفاعلي هنا — base بس).
CREATE TABLE academy_exam_attempts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id       UUID NOT NULL REFERENCES technician_profiles(id),
  course_id           UUID NOT NULL REFERENCES academy_courses(id),
  score               SMALLINT NOT NULL,
  passed              BOOLEAN NOT NULL,
  recorded_by_user_id UUID REFERENCES users(id),
  attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_academy_exam_attempts_technician ON academy_exam_attempts (technician_id);
CREATE INDEX idx_academy_exam_attempts_course ON academy_exam_attempts (course_id);

INSERT INTO permissions (name, resource, action) VALUES
  ('academy.manage', 'academy', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'academy.manage'
WHERE r.name IN ('super_admin', 'ops_manager');
