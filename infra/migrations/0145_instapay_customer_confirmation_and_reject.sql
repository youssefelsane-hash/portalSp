-- baytak (صُنّاع) — 0145: تأكيد العميل لتحويل InstaPay + سبب رفض الأدمن (ADR-0013 §7 تكملة)
-- راجع apps/api/src/modules/payments/README.md — فجوتين حقيقيتين اتلقطتا في تدفق InstaPay:
-- (1) العميل مالوش أي طريقة يسجّل بيها "أنا حوّلت فعلاً" بخلاف polling محلي بلا أثر على السيرفر،
--     يعني الأدمن مايقدرش يفرّق بين "العميل لسه ما حوّلش" و"العميل بيقول إنه حوّل، محتاج مراجعة".
-- (2) مفيش endpoint رفض لدفعة InstaPay معلّقة (بعكس طلبات الصرف اللي عندها approve/reject/complete).

ALTER TABLE payments ADD COLUMN customer_confirmed_transfer_at TIMESTAMPTZ NULL;
COMMENT ON COLUMN payments.customer_confirmed_transfer_at IS
  'InstaPay بس — العميل ضغط "حوّلت الفلوس" فعليًا (مش مجرد polling محلي)، بيساعد الأدمن يفرّق
   بين دفعة محدش لمسها ودفعة العميل بيدّعي إنه حوّلها فعلاً.';
