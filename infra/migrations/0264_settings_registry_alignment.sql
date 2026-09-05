-- تدقيق C-3 + D-2 + L-1 + L-3 + L-2 — مواءمة جدول `settings` مع سجل المفاتيح الجديد
-- (`apps/api/src/modules/settings/settings-registry.ts`).
--
-- بعد الـmigration دي، `settings-registry.spec.ts` بيقارن الاتجاهين على قاعدة حيّة وبيفشل لو
-- أي طرف اختلف — يعني الفئتين اللي تحت مايقدروش يرجعوا تاني بصمت.

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) مفاتيح الكود بيقراها ومالهاش صف ⇒ الأدمن مش قادر يضبطها أبدًا (C-3)
-- ═══════════════════════════════════════════════════════════════════════════
-- الخمسة دول بيتقروا في `matching.service.ts` (سطر 801 وحواليه). مكانش ليهم صف خالص، يعني
-- `AdminSettingsController.update()` بيرمي 404 عليهم (`SettingsService.getOrThrow`) ومفيش
-- endpoint إنشاء إعداد — فكل ضبط توزيع الطوارئ كان hardcoded فعليًا وتغييره محتاج deploy.
--
-- **القيم هنا = قيم الـfallback في الكود بالحرف** (`EMERGENCY_*_FALLBACK`) — صفر تغيير سلوك،
-- الفرق الوحيد إنها بقت قابلة للضبط من اللوحة.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.emergency_batch_size', '10'::jsonb, 'number', 'matching',
   'عدد الفنيين في أول دفعة بث لطلب الطوارئ', false),
  ('matching.emergency_subsequent_batch_size', '10'::jsonb, 'number', 'matching',
   'عدد الفنيين في كل دفعة بث تالية لطلب الطوارئ', false),
  ('matching.emergency_response_timeout_seconds', '20'::jsonb, 'number', 'matching',
   'مهلة رد الفني على عرض طوارئ بالثانية قبل الجولة اللي بعدها', false),
  ('matching.emergency_max_technicians_contacted', '40'::jsonb, 'number', 'matching',
   'أقصى عدد فنيين يتواصل معاهم النظام لطلب طوارئ واحد قبل التصعيد', false),
  ('matching.emergency_escalation_after_rounds', '2'::jsonb, 'number', 'matching',
   'عدد جولات الطوارئ الفاشلة قبل تصعيد الطلب للإدارة', false)
ON CONFLICT (key) DO NOTHING;

-- ١-ب) نفس الفئة بالظبط، اكتشفها **الاختبار الجديد** مش التدقيق اليدوي.
-- `booking.match_preview_*` تحديدًا فاتوا التدقيق لأنهم مكتوبين على أكتر من سطر
-- (`getNumber(\n  'key',`) فالبحث النصّي السريع ما شافهمش — وده بالظبط سبب وجود اختبار آلي
-- بدل مراجعة بالعين. القيم كلها = ثوابت الـfallback في الكود بالحرف.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('booking.match_preview_candidate_limit', '25'::jsonb, 'number', 'booking',
   'أقصى عدد فنيين مرشّحين بيتحسبوا في معاينة المطابقة قبل الحجز (السقف الصلب 100)', false),
  ('booking.match_preview_ttl_seconds', '300'::jsonb, 'number', 'booking',
   'مدة صلاحية معاينة المطابقة بالثانية قبل ما تتحسب من جديد (السقف الصلب 1800)', false),
  ('catalog.most_requested_window_days', '90'::jsonb, 'number', 'catalog',
   'نافذة الأيام اللي بيتحسب عليها «الأكثر طلبًا» في الكتالوج', false),
  ('matching.max_rounds', '4'::jsonb, 'number', 'matching',
   'أقصى عدد جولات بث للطلب العادي قبل ما المطابقة تتوقف وتتصعّد', false),
  ('ranking.bayesian_min_samples', '5'::jsonb, 'number', 'ranking',
   'أقل عدد تقييمات قبل ما متوسط الفني يُحسب بوزنه الكامل في الترتيب', false),
  ('ranking.bayesian_prior_mean', '4.0'::jsonb, 'number', 'ranking',
   'المتوسط المرجعي اللي بيتسحب ناحيته تقييم الفني قليل العينات (تنعيم بايزي)', false),
  ('security.dedup_window_seconds', '300'::jsonb, 'number', 'security',
   'نافذة تجميع الأحداث الأمنية المتطابقة في حدث واحد بدل صفوف مكررة', false),
  ('security.repeated_denial_burst_threshold', '5'::jsonb, 'number', 'security',
   'عدد الرفضات المتتالية اللي بعدها يتسجّل حدث «رفض متكرر»', false),
  ('security.repeated_denial_burst_window_seconds', '900'::jsonb, 'number', 'security',
   'النافذة الزمنية اللي بيتحسب فيها عدّاد الرفض المتكرر', false),
  ('security.repeated_denial_escalate_threshold', '5'::jsonb, 'number', 'security',
   'عدد تكرارات الحدث اللي بعدها يتصعّد لخطورة أعلى', false),
  ('workforce.idle_threshold_seconds', '300'::jsonb, 'number', 'workforce',
   'بعد كام ثانية بلا نشاط يتحوّل الموظف من ACTIVE لـIDLE', false)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) صفوف ظاهرة للأدمن ومحدش بيقراها ⇒ تعديلها مالوش أي أثر (D-2، L-1، L-3)
-- ═══════════════════════════════════════════════════════════════════════════
-- اتأكد بمقارنة كل صف في الجدول بكل literal في المستودع كله (`.ts`/`.tsx`/`.dart`/`.sql`):
-- صفر مرجع لكل واحد فيهم. المشروع كتب الحكم بنفسه في `0260`: «إعداد ظاهر في لوحة الإدارة
-- ومالوش أي أثر أسوأ من مفيش إعداد».
--
-- ملاحظات على الأخطر فيهم:
--   • `otp.expiry_minutes` — الأدمن يفتكر إنه بيضبط أمان الـOTP. مدة الصلاحية الفعلية جاية من
--     الكود مش من هنا.
--   • `pricing.default_commission_percent` / `commission.domestic_worker_percentage` — بيوحوا
--     إنهم بيتحكموا في فلوس. العمولة الحقيقية بتتحسب من `commission_base.*` و
--     `commission.*_adjustment_percentage`.
--   • `matching.radius_km_initial` / `matching.radius_km_max` — بيوحوا بنطاق بحث بالكيلومتر.
--     النطاق الجغرافي الحقيقي بيتحدد بـ`JOIN technician_zones` (منطقة خدمة، مش دائرة)،
--     والمسافة بتدخل الترتيب عبر `matching.distance_weight*` تحت.
--   • `matching.near_term_request_days` — نسخة ميتة من `matching.near_term_request_hours`
--     (الشغّال). مفتاحان بيوحوا بنفس المعنى وواحد بس بيشتغل = الأدمن يعدّل الغلط ويستنتج إن
--     الميزة مكسورة.
--   • `matching.deferred_dispatch_lead_hours` — `0260` كان المفروض يشيله؛ الحذف هنا idempotent
--     فبيغطي أي بيئة الـmigration دي ما وصلتهاش.
DELETE FROM settings WHERE key IN (
  'cancellation.team_workers_can_self_cancel',
  'commission.domestic_worker_percentage',
  'loyalty.point_value_cents',
  'matching.deferred_dispatch_lead_hours',
  'matching.near_term_request_days',
  'matching.radius_km_initial',
  'matching.radius_km_max',
  'notification_engine.critical_offer_bypasses_quiet_hours',
  'orders.auto_cancel_after_minutes',
  'otp.expiry_minutes',
  'pricing.default_commission_percent',
  'productivity.enabled',
  'projects.quote_expiry_days',
  'projects.warranty_holdback_percentage',
  'recurring.payment_reminder_hours'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) «أقرب فني ياخد الطوارئ» بقى مفعّل فعلاً (L-2 — طلب مالك مباشر)
-- ═══════════════════════════════════════════════════════════════════════════
-- البنية كاملة وموصولة صح من ADR-0062: المسافة بتدخل `rank_score` كـ
-- `- (distance_km) * $26` والوزن بيتحسب من `resolveDistanceWeight()` حسب سياق الطلب.
-- بس **الافتراضي كان صفر**، يعني المسافة كانت كاسر تعادل بس — والمكوّن المهيمن هو وزن مستوى
-- الفني، فـفني مستوى أعلى على بُعد ٣٠ كم كان بيسبق فني أقرب بـ٢ كم. المالك طلب العكس بالنص
-- للطوارئ: «أول ٣-٤ أشخاص بيكونوا دول أقرب أشخاص».
--
-- **معايرة القيمة ٢٫٠ (مش رقم عشوائي)**: أوزان أولوية المستوى في `technician_level_config` هي
-- 0/10/20/30/40 — الفرق بين مستويين متجاورين = ١٠ نقط. بوزن ٢٫٠، كل ٥ كيلومتر بتساوي فرق مستوى
-- كامل. يعني جوّه مدينة (مسافات آحاد الكيلومترات) القرب بيغلب فرق المستوى، وفني أبعد بكتير
-- بيحتاج فرق مستويين+ عشان يسبق القريب. ده «الأقرب الأول» عمليًا من غير ما نلغي وزن المستوى
-- تمامًا — الطوارئ قيمتها الأساسية إنه يوصل بسرعة.
--
-- **مقصور على الطوارئ**: `distance_weight` العام والسياقات التانية سايبينهم صفر زي ما هم —
-- الحجز العادي المفروض يفضل بيرجّح الجودة/المستوى. الأدمن يقدر يعدّل الأربعة من اللوحة، وأثر
-- التغيير ظاهر مفصولاً في `GET /admin/orders/:id/explain-candidates` (`distance_penalty`).
UPDATE settings SET value = '2.0'::jsonb WHERE key = 'matching.distance_weight_emergency';
