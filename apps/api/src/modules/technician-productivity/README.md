# technician-productivity

نظام تسجيل إنتاجية موزون **قابل للتهيئة بالكامل من الأدمن**، مبني فوق بيانات
`technician_kpi_snapshots` الموجودة بالفعل (موديول `technician-kpi`) — راجع `docs/08-pricing-engine-and-platform-vision.md`
§14/§17.14 للسياق الكامل والطلب الأصلي.

## القرار المعماري: طبقة حساب، مش محرك موازٍ

هذا الموديول **لا ينشئ أي جدول جديد ولا يجمع أي بيانات جديدة**. هو طبقة قراءة/حساب ثانية فوق
نفس صفوف `technician_kpi_snapshots` (شهرية، واحدة لكل `(technician_id, period_year, period_month)`).
السبب: المالك طلب صراحة "يتكامل مع KPI الموجود بدل محرك أداء موازٍ جديد"، والبيانات المطلوبة
(طلبات مكتملة، معدلات، تقييم، شكاوى، إيراد، درجة KPI) مسجّلة بالفعل هناك — تكرارها في جدول جديد
كان هيبقى ازدواجية بلا داعي.

الفرق عن KPI نفسه:
- **KPI**: لقطة شهرية واحدة، وزن فقط قابل للتعديل، بلا `enabled`/`direction`/`minSampleSize` لكل مقياس.
- **Productivity**: فترة تقييم قابلة للتهيئة (تجميع عبر N شهر تريلينج، مش شهر واحد ثابت)، وكل مقياس
  له `enabled` (تفعيل/تعطيل مستقل)، `direction` (`higher_is_better`/`lower_is_better`)،
  `minSampleSize` (استبعاد بسبب واضح لو العينة صغيرة)، و`target` اختياري للمقاييس اللي مش نسبة
  أصلاً (عدد طلبات، إيراد بالقرش).

`monthly_kpi_score` نفسه أحد الـ8 مقاييس القابلة للتفعيل/التعطيل هنا — تكامل حرفي مع KPI، مش مجرد
إشارة إليه.

## الإعداد: `productivity.metrics_config`

`value_type='json'` في جدول `settings` (مجموعة `productivity`) — يتعدّل بالكامل من محرر الإعدادات
العام الموجود في `apps/admin` (`/settings`)، **مفيش شاشة أدمن مخصوصة لازمة**. الشكل الكامل في
`productivity-metrics-config.ts` (`ProductivityMetricsConfig`)، القيم الافتراضية في
`DEFAULT_PRODUCTIVITY_METRICS_CONFIG` — تطويرية بس، مش سياسة عمل دائمة.

**تحذير مهم لأي تعديل مستقبلي على `settings`**: `SettingsService` بتبطّل كاش Redis بس جوّه
`update()` نفسها (إبطال فوري) — أي تعديل مباشر بـSQL خام على جدول `settings` (زي سكريبت migration
أو استعلام يدوي) **لازم** يمسح مفتاح الكاش يدويًا (`settings:<key>`) وإلا القراءة الجاية هترجّع
القيمة القديمة لحد انتهاء TTL الدفاعي (دقيقة). راجع `technician-productivity.service.spec.ts` لمثال
حي على البَقّة دي وإصلاحها.

## الحساب (`TechnicianProductivityService.computeForTechnician`)

1. يجيب آخر N شهر (افتراضي: `productivity.default_evaluation_period_months`) من
   `technician_kpi_snapshots` للفني.
2. لكل مقياس مفعّل: تجميع القيمة الخام عبر الفترة (SUM للعدادات/الإيراد، متوسط بسيط للنسب،
   ratio-of-sums لمعدل الشكاوى، متوسط موزون بعدد التقييمات للتقييم).
3. تطبيع لـ0-100 (`normalize()`) — تبديل صريح على مفتاح المقياس (`customer_rating` بس بيتحول من
   1-5)، مش استنتاج من مدى القيمة (بَقّة اتصلحت قبل ما توصل للاختبار — راجع الكومنت في الكود).
4. استبعاد المقاييس المعطّلة أو اللي عينتها أصغر من `minSampleSize`، مع `exclusion_reason` عربي
   واضح لكل حالة استبعاد — **مفيش استبعاد صامت**.
5. متوسط موزون على المقاييس المتبقية فقط (توزيع تلقائي للأوزان، نفس فلسفة KPI). فني بلا بيانات
   كفاية → `overall_score: null` + `explanation` واضح، مش استثناء.

## الصلاحية والـ endpoint

`GET /admin/technician-productivity/:technicianId?months=N` — `technician_productivity.view`
(ممنوحة لـ`ops_manager`/`finance`، migration `0096`، نفس نمط `technician_kpi.calculate`).
Phase 1 قراءة بس — مفيش موافقة/دفع زي KPI (لو اتطلب لاحقًا، فجوة موثّقة هنا).

## فجوات موثّقة صراحة

- مفيش UI أدمن مخصوص لعرض التقرير (`GET` endpoint موجود، الاستهلاك من `/settings` العام + أي
  استدعاء مباشر — شاشة عرض مخصوصة لو اتطلبت لاحقًا).
- §17.15 (تدرّج دفعات الطوارئ، نفس §17 نقطة 15 في `docs/08`) **مش جزء من هذا الموديول** — نطاق
  مختلف تمامًا (تعديل منطق `MatchingService`/`AssistantMatchingService`)، لسه `NOT STARTED`.
