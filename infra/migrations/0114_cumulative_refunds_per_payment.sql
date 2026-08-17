-- الاسترداد الجزئي المتكرر يتطلب أكثر من صف Refund للدفعـة نفسها. القيد الفريد القديم كان
-- يمنع ذلك تمامًا ويجبر النظام على اعتبار أي refund جزئي نهائيًا. لا نغيّر صفوفًا قائمة؛
-- نبدل القيد بفهرس عادي يظل مفيدًا لمسارات reconciliation والتقارير.
DROP INDEX IF EXISTS idx_refunds_payment_id_unique;

CREATE INDEX IF NOT EXISTS idx_refunds_payment_status
  ON refunds(payment_id, refund_status);
