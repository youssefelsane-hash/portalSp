-- baytak (صُنّاع) — 0143: إعدادات انقسام قريب/بعيد في الحجز (ADR-0017)
-- راجع docs/adr/0017-booking-availability-opt-out-model.md بند 7 و10 للتصميم الكامل.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  -- بند 7 — "النهاردة وبكرة" = نافذة الطلب/القبول-الرفض العادية. أي طلب لتاريخ بعد كده بيتأكد
  -- تلقائيًا لأفضل فني مؤهّل بلا انتظار قبول (autoConfirmFutureOrder في matching.service.ts).
  ('matching.near_term_request_days', '1', 'number', 'matching',
   'عدد الأيام المستقبلية (من النهاردة) اللي بتفضل طلب/قبول-رفض عادي — بعدها تأكيد تلقائي', false),
  -- بند 10 — الجولة اللي بعدها بيتوسّع البحث ليشمل فنيين "مرتبطين بس مشغولين بطلب تاني نشط
  -- دلوقتي" (بشرط الخدمة/المنطقة يفضلوا سارية دايمًا). NULL/قيمة أكبر من matching.max_rounds
  -- تعطّل التوسيع تمامًا.
  ('matching.broaden_to_busy_after_round', '4', 'number', 'matching',
   'رقم الجولة اللي بعدها يتوسّع البحث لفنيين مرتبطين لكن مشغولين حاليًا', false);
