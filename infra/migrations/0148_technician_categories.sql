-- baytak (صُنّاع) — 0148: تأهيل الفني بمستوى التخصص/الفئة (trade/category) بدل خدمة بخدمة (ADR-0018 §8)
-- راجع docs/adr/0018-emergency-vs-scheduled-and-trade-eligibility.md للتصميم الكامل.
--
-- طلب صريح من المالك (2026-08-19): الفني ميحتاجش يتربط بعشرات صفوف technician_services واحد
-- واحد عشان يشتغل في تخصصه (سباك معتمد لسدّ حوض، تسريب مياه، تركيب سخان... كل ده لوحده). لو
-- الفني اتعمد كـ"سباكة" (فئة/تخصص)، يبقى مؤهّل تلقائيًا لكل خدمات السباكة داخل الفئة دي.
--
-- الجدول ده **إضافة جنب technician_services مش بديل ليها** — الأهلية بقت "خدمة مباشرة معتمدة
-- (technician_services) OR فئة الخدمة معتمدة (technician_categories)"، الاتنين ساريين معاً.
-- نفس نمط 0130_technician_service_self_declaration.sql بالحرف (تصريح ذاتي من الفني → مراجعة
-- أدمن) — بس بلا skill_level/completed_count/average_rating/tested_at (المفاهيم دي معناها
-- بس على مستوى خدمة واحدة محددة، مش فئة كاملة).

CREATE TABLE technician_categories (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id         UUID          NOT NULL REFERENCES technician_profiles(id),
  category_id           UUID          NOT NULL REFERENCES service_categories(id),
  is_active             BOOLEAN       NOT NULL DEFAULT false,
  verification_status   technician_service_verification_status NOT NULL DEFAULT 'pending_verification',
  is_self_declared       BOOLEAN      NOT NULL DEFAULT true,
  rejection_reason       TEXT         NULL,
  reviewed_by_user_id    UUID         NULL REFERENCES users(id),
  reviewed_at            TIMESTAMPTZ  NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (technician_id, category_id)
);

-- نفس فهرس الأهلية الحقيقي في technician_services (matching بيستخدمه فعليًا).
CREATE INDEX idx_technician_categories_category_id ON technician_categories(category_id) WHERE is_active = true;
CREATE INDEX idx_technician_categories_pending_verification
  ON technician_categories (created_at)
  WHERE verification_status = 'pending_verification';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_categories
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
