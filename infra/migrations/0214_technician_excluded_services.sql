-- baytak — 0214: حجب خدمات بعينها عن فني بعينه (ADR-0049، docs/08 §86).
--
-- **طلب مالك صريح (2026-08-28)**: «الديفولت إن هو فعلاً بيروح كله، ولكن لو الأدمين حابب بيحجب
-- عنه حاجة بيخش عنده ويحجبها».
--
-- **قائمة حجب مش قائمة سماح** — وجود الصف = ممنوع، وغيابه = مسموح. ده اللي بيحافظ على الخاصية
-- اللي ADR-0018 §8 اتعمل عشانها: فني اتعمد في فئة بيشتغل على كل خدماتها **فورًا**، وخدمة جديدة
-- تتضاف للكتالوج بيشوفها كل المؤهّلين من غير ما حد يفتكر يعتمدها. قائمة سماح كانت هتقلب
-- الاتنين: كل فني جديد يحتاج عشرات الصفوف، وأي خدمة جديدة تفضل مخفية عن الكل بصمت.

CREATE TABLE technician_excluded_services (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id       UUID NOT NULL REFERENCES technician_profiles(id) ON DELETE CASCADE,
  service_id          UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  -- سبب الحجب بكلام الأدمن — بيتعرض في لوحة الأدمن بس (الفني مابيتخطرش بالحجب، ADR-0049).
  reason              TEXT,
  excluded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- رفع الحجب بيمسح الصف فعليًا (مش soft delete): الحالة هنا ثنائية بحتة، وسجل "مين حجب ومين
  -- رفع وامتى" مكانه الـaudit log زي كل قرارات الأدمن التانية.
  CONSTRAINT uq_technician_excluded_service UNIQUE (technician_id, service_id)
);

-- الاستعلام الوحيد اللي بيتنفّذ على الجدول ده في المسار الساخن هو
-- `NOT EXISTS (... WHERE technician_id = ? AND service_id = ?)` جوّه شرط الأهلية الموحّد —
-- والـUNIQUE فوق بيغطّيه بالكامل، فمفيش فهرس إضافي محتاج.
