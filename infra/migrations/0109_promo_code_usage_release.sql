-- §24 تدقيق الاكتمال الداخلي — فجوة حقيقية موثّقة (order-auto-cancel.service.ts، orders.service.ts):
-- promo_codes.used_count/spent_cents كانوا بيتزودوا وقت استخدام الكود بس مفيش أي إلغاء (release)
-- لاستخدامه في أي مسار إلغاء طلب — كود محدود الاستخدام كان ممكن "يخلص" بسبب طلبات اتلغت قبل أي
-- خدمة فعلية. عمود released_at بيسمح بتتبع الإلغاء ده بشكل append-only (مش حذف الصف) — لو NULL
-- يبقى الاستخدام لسه سارٍ، لو متسجّل يبقى اتّرجع رصيده للكود.
ALTER TABLE promo_code_usages
  ADD COLUMN released_at TIMESTAMPTZ NULL;
