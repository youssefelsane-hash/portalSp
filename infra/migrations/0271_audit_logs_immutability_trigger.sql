-- baytak — 0271: فرض عدم قابلية سجل التدقيق للتعديل فعليًا (تدقيق T-1)
--
-- 0011 كتب `REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;` والتعليق فوقه بيقول
-- «ممنوع أي تعديل أو حذف عليه»، والكود بيتّكل على الكلام ده صراحةً (`security-events.service.ts`
-- سطر ١٤٤، `0135_security_events.sql` سطر ٣، وتعليق الـentity نفسه).
--
-- المشكلة: `REVOKE ... FROM PUBLIC` مابيأثّرش على **مالك الجدول**، والتطبيق بيتصل بنفس الدور
-- اللي عامل الجداول (`baytak`). فحص الصلاحيات الفعلية بيرجع INSERT/SELECT/UPDATE/DELETE كلها —
-- يعني سطر `DELETE FROM audit_logs` واحد في أي كود أو سكربت صيانة بيمسح دليل الإجراء اللي حصل.
-- الضمانة اللي النظام كله متّكل عليها ماكانتش موجودة أصلاً.
--
-- الإصلاح: تريجر. التريجرات بتشتغل على المالك زي أي دور تاني، فده الشيء الوحيد اللي بيدّي
-- الوعد ده معنى وإحنا شغّالين بدور المالك.
--
-- **مخرج واحد مقصود**: عملية صيانة حقيقية (سياسة احتفاظ، أو تنضيف بيانات اختبار) بتقول كده
-- صراحةً بـ`set_config('app.audit_purge','on',true)` جوّه نفس الترانزاكشن. المخرج ده مش ثغرة
-- لأنه:
--   * مايتعملش بالسهو — مفيش `DELETE` عادي بيعدّي،
--   * محلي للترانزاكشن (`true`) فمابيسربش لبقية اتصالات الـpool،
--   * ومحروس بنيويًا: `audit-logs-immutability.spec.ts` بيفشل لو أي ملف تحت `src` غير
--     ملفات الاختبار (`*.spec.ts` / `*.testing.ts`) ذكر المفتاح ده.

CREATE OR REPLACE FUNCTION audit_logs_reject_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'TRUNCATE' AND current_setting('app.audit_purge', true) = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION 'audit_logs غير قابل للتعديل أو الحذف (%): سجل التدقيق append-only', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

-- TRUNCATE مابيعديش على تريجر صف — بيحتاج تريجر STATEMENT منفصل، و`TG_OP` هنا 'TRUNCATE'
-- فبيقع على فرع الاستثناء دايمًا حتى مع المخرج (مفيش سبب مشروع لمسح الجدول كله).
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
