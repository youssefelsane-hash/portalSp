-- baytak (صُنّاع) — 0056: أساس محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، docs/07 الجزء د)
-- المالك اعتبر ده "أهم إضافة على الإطلاق" — بعد كل شغلانة، النظام يسجّل المساحة الفعلية والوقت
-- الفعلي وعدد العمالة الفعلي، وبعد فترة كافية (100 ألف شغلانة في مثال المصدر) يبدأ يحدّث الأرقام
-- القياسية تلقائيًا بدل ما تفضل نظرية للأبد.
--
-- **نطاق هذا الجزء تحديدًا (مرحلة 1 بس)**: التسجيل نفسه، مش خوارزمية التحديث التلقائي — ده
-- مرحلة لاحقة فعليًا (محتاج بيانات تاريخية ضخمة مش موجودة لسه). كمان orders الحالية **مش بتحمل**
-- standard_data_id/المساحة المطلوبة/عدد العمالة المُعيَّن أصلاً (التكامل الكامل بين "اعتماد"
-- وحجز الشغلانات الكبيرة ومحرك الإنتاجية لسه خارج نطاق هذه الرؤية — "التركيز الحالي على إن
-- الهيكل يخلص الأول" بالحرف من كلام المالك)، فمفيش نقطة تلقائية لحظة اكتمال الطلب تسجّل من
-- عندها دلوقتي. التسجيل هنا **يدوي من الأدمن/العمليات** (نفس فكرة أي بيانات تشغيلية بتتجمع
-- بمعرفة الفريق قبل ما يبقى فيه تكامل تلقائي كامل)، عشان البيانات تبدأ تتجمع من أول يوم فعليًا
-- بدل ما تستنى تكامل مستقبلي غير موجود.
CREATE TABLE service_productivity_actuals (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_standard_data_id UUID         NOT NULL REFERENCES service_standard_data(id),
  order_id                UUID          NULL REFERENCES orders(id),
  actual_units            NUMERIC(10,2) NOT NULL,
  actual_days             NUMERIC(6,2)  NOT NULL,
  actual_technicians      SMALLINT      NOT NULL,
  actual_assistants       SMALLINT      NOT NULL,
  notes                   TEXT          NULL,
  recorded_by_user_id     UUID          NULL REFERENCES users(id),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_productivity_actuals_standard_data ON service_productivity_actuals(service_standard_data_id);
