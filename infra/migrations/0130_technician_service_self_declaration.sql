-- Script 4 §2-7 — تصريح مهارات ذاتي من الفني + موافقة أدمن (docs/08، اقتراحات Script 4).
-- كانت فجوة موثّقة صراحة: technician_services كان 100% معيّن من الأدمن يدوياً، مفيش أي مسار
-- للفني يطلب خدمة بنفسه. الفني ≠ مجرد technician=true — لازم نعرف بالظبط إيه الشغل اللي مسموح
-- له يستلمه، ومطالبة الفني بمهارة ما تديهوش أهلية أوتوماتيك.

CREATE TYPE technician_service_verification_status AS ENUM (
  'pending_verification', -- طلب جديد من الفني نفسه، لسه ماوصلش لمراجعة أدمن
  'approved',              -- معتمد — مؤهل فعلياً للمطابقة (matching)
  'rejected',              -- رفضه الأدمن بسبب
  'suspended'               -- كان معتمد وبعدين اتوقف (أدمن)
);

ALTER TABLE technician_services
  ADD COLUMN verification_status technician_service_verification_status NOT NULL DEFAULT 'approved',
  ADD COLUMN is_self_declared     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN rejection_reason     TEXT        NULL,
  ADD COLUMN reviewed_by_user_id  UUID        NULL REFERENCES users(id),
  ADD COLUMN reviewed_at          TIMESTAMPTZ NULL;

-- الصفوف الموجودة كلها معيّنة من الأدمن يدوياً من زمان (default='approved' فوق بيغطّيهم) —
-- صفر خطر ترحيل، صفر مطالبة رجعية بإعادة اعتماد شغل شغّال بالفعل.

-- طابور المراجعة (GET .../pending) بيفلتر على الحالة دي كتير — index جزئي زي باقي جداول المشروع.
CREATE INDEX idx_technician_services_pending_verification
  ON technician_services (created_at)
  WHERE verification_status = 'pending_verification';
