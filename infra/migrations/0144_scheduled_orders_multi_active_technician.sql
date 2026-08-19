-- baytak (صُنّاع) — 0144: تضييق uq_orders_one_active_per_technician لـASAP بس (ADR-0017)
-- راجع docs/adr/0017-booking-availability-opt-out-model.md بند 5-7 وmatching/README.md.
--
-- السياق: uq_orders_one_active_per_technician (migrations 0118+0121) كانت UNIQUE INDEX على
-- technician_id بس (بلا اعتبار للموعد) — بتفترض "فني واحد بياخد طلب نشط واحد في نفس الوقت"
-- بلا استثناء. ده كان صحيح قبل ADR-0017 (كل طلب نشط كان بيُعامل كـ"مشغول بالكامل" لحد ما يخلص).
-- دلوقتي فني عنده طلب ASAP نشط (تسليك مواصير نص يوم مثلاً) لازم يقدر "يقبل" طلب مجدول تاني ليوم
-- بعيد كمان (application-level eligibility بقى بيسمح بده صراحة) — لكن الـUNIQUE INDEX القديم
-- كان بيرفض أي INSERT/UPDATE تاني لنفس الفني بحالة نشطة، بغض النظر عن الموعد، برسالة DB خام مش
-- ApiException واضحة. الإصلاح: تضييق نطاق القيد ليسري بس على الطلبات الفورية (scheduled_at
-- IS NULL) — فني واحد لسه يقدر ياخد طلب ASAP واحد بس في نفس الوقت (بلا تغيير)، لكن أي عدد من
-- الطلبات المجدولة الغير متقاطعة زمنيًا مسموحة (يتفحصوا عند الكتابة عبر assertEligible/
-- assignmentGuard تحت قفل الفني — نفس نمط accept() الموجود، دفاع عمق مش قيد DB وقت الكتابة).
--
-- ملحوظة صريحة (فجوة موثّقة، مش سهو): القيد ده مبيمنعش DB-level تعارض زمني حقيقي بين طلبين
-- *مجدولين* لنفس الفني بيتقاطعوا (مثلاً حجزين لنفس الساعة بالظبط) — الحماية الوحيدة لحالة نادرة
-- زي دي دلوقتي هي قفل صف الفني (pessimistic_write) + إعادة فحص assertEligible داخل نفس
-- الـtransaction قبل الكتابة (matching.service.ts's autoConfirmFutureOrder وaccept() الاتنين).
-- قيد GIST EXCLUDE حقيقي على نافذة زمنية [scheduled_at, scheduled_at+duration] محتاج عمود
-- duration مخزّن فعليًا على orders نفسها (مش join لـservices، EXCLUDE constraints ما بتدعمش
-- joins) — تحسين مستقبلي مؤجَّل عمدًا لسيشن منفصلة، مش أولوية دلوقتي (السباق ده نادر جدًا:
-- محتاج طلبين مختلفين لنفس الفني بالظبط يتأكدوا في نفس اللحظة تقريبًا).

CREATE UNIQUE INDEX uq_orders_one_active_asap_per_technician
  ON orders(technician_id)
  WHERE technician_id IS NOT NULL
    AND deleted_at IS NULL
    AND scheduled_at IS NULL
    AND order_status IN (
      'accepted',
      'technician_on_way',
      'technician_arrived',
      'in_progress',
      'awaiting_quote_approval'
    );

DROP INDEX uq_orders_one_active_per_technician;
