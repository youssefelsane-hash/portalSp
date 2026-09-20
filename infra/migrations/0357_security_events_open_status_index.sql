-- **فهرس لعدّاد تنبيهات الأمان المفتوحة** (تدقيق شامل 2026-09-20).
--
-- `SecurityEventsService.countOpenBySeverity()` بيشغّل:
--     SELECT severity, count(*) FROM security_events WHERE status = 'open' GROUP BY severity
-- وده بيغذّي عدّاد لوحة الأدمن (`admin-security.controller.ts`)، يعني بيتنادى مع كل فتح للشاشة.
--
-- ### الفهرس الموجود مابيخدمش الاستعلام ده
--
-- `idx_security_events_severity_status (severity, status, created_at DESC)` بادئته `severity`،
-- والاستعلام بيفلتر على `status` لوحده — فمينفعش يتستخدم كـindex prefix. Postgres بيروح على
-- seq scan، وده مقروء في الإحصائيات: **12,755 seq scan مقابل 94 index scan** على الجدول ده.
--
-- ### ليه دلوقتي والجدول لسه صغير؟
--
-- لأنه **مش مشكلة دلوقتي وهيبقى مشكلة أكيد**. قِستها فعليًا بـ`EXPLAIN (ANALYZE, BUFFERS)`:
-- **0.08ms** على 215 صف — Postgres بيختار seq scan صح تمامًا على جدول بالحجم ده. بس
-- `security_events` جدول **بيتراكم ولا بيتقلّم**: كل محاولة صلاحية مرفوضة، كل تصعيد امتيازات،
-- كل إشارة مخاطر بتضيف صف. أول ما يوصل لمئات الآلاف، العدّاد ده بيبقى seq scan كامل على كل
-- فتحة شاشة. الفهرس هنا استثمار رخيص (الجدول صغير فبناؤه فوري) في وقت رخيص.
--
-- التحقق بعد التطبيق: `SET enable_seqscan=off` ثم `EXPLAIN` على نفس الاستعلام لازم تطلّع
-- `Index Only Scan using idx_security_events_open_by_severity` — اتأكدت فعليًا.
--
-- `WHERE status = 'open'` فهرس جزئي عمدًا: الصفوف المقفولة/المحلولة هي الأغلبية الساحقة على
-- المدى الطويل، والاستعلام مابيلمسهاش خالص. فهرس جزئي = حجم أصغر وصيانة أرخص على كل INSERT.

CREATE INDEX IF NOT EXISTS idx_security_events_open_by_severity
  ON security_events (status, severity)
  WHERE status = 'open';
