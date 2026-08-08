-- baytak — 0035: تحويل قيود فرادة phone_number/email/referral_code لـ partial indexes
-- (بتتجاهل الحسابات المحذوفة) — مرجع: apps/api/src/modules/admin/README.md
-- (بَقّة حقيقية اتلقطت وقت اختبار حذف الموظفين)
--
-- الثلاثة كانوا UNIQUE عادي على العمود كله من 0003_auth.sql — بيشمل الصفوف المحذوفة
-- (deleted_at IS NOT NULL)، رغم إن idx_users_phone_number/idx_users_referral_code (من نفس
-- الملف) partial بالفعل (WHERE deleted_at IS NULL) — تضارب واضح بين القيد والإندكس، واتنين
-- إندكس مختلفين على نفس العمود. النتيجة: أي حساب اتعمله soft-delete (موظف اتمسح عبر
-- /admin/employees/:id، عميل عمل deleteMe لنفسه) بيقفل رقم الهاتف/الإيميل بتاعه للأبد — أي
-- محاولة تسجيل تانية بنفس القيمة بترمي duplicate key violation خام (500 غير واضح) بدل رسالة
-- تحقق نضيفة. اتأكدت البَقّة حياً: soft-delete لموظف تجريبي ثم محاولة تسجيل عميل جديد بنفس
-- رقم الهاتف رمت "duplicate key value violates unique constraint users_phone_number_key"
-- فعلياً في الـ server log.
--
-- الحل: قيد UNIQUE واحد partial لكل عمود (يغني عن الإندكس القديم غير الفريد كمان).
DROP INDEX idx_users_phone_number;
DROP INDEX idx_users_referral_code;

ALTER TABLE users DROP CONSTRAINT users_phone_number_key;
ALTER TABLE users DROP CONSTRAINT users_email_key;
ALTER TABLE users DROP CONSTRAINT users_referral_code_key;

CREATE UNIQUE INDEX users_phone_number_key ON users (phone_number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_email_key ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_referral_code_key ON users (referral_code) WHERE deleted_at IS NULL;
