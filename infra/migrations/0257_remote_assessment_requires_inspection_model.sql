-- docs/08 §125 — «التقييم بالصور» مقصور على `inspection_then_quote`، مفروض على مستوى القاعدة.
--
-- **البَقّة اللي بيقفلها (اتأكدت بفحص حي على الـAPI)**: `assessmentRouteRejection()` في
-- `apps/api/src/modules/orders/assessment-route-guard.ts` بترفض `request_remote_quote` لأي خدمة
-- طريقة تسعيرها مش «كشف ثم عرض سعر»، لأن التقييم بالصور معناه غياب السعر وقت الحجز (ADR-0060 §1).
-- لكن طبقة الأدمن مكانتش بتشوف `pricing_model` وهي بتتحقق من سياسة التقييم، فكان ينفع تتحفظ خدمة
-- `formula` وعليها «تقييم بالصور — مفعّل»: الزرار شغّال في الواجهة ومالوش أي أثر عند العميل.
--
-- وأسوأ من كده، التركيبة دي كانت بتخلق خدمة **مش قابلة للحجز بأي مسار**:
--   pricing_model='formula' + price_certainty_mode='assessment_required' + assessment_route_policy='remote_only'
--   → مسار الصور مرفوض (مش كشف-ثم-سعر)، ومسار المعاينة مرفوض (السياسة «بالصور فقط»).
-- ده بالظبط بلاغ المالك «بيقعد يجيب دايماً موانع كتير إنه مينفعش يبعت صور للإدارة».
--
-- تطبيع البيانات الموجودة أولاً، وبعدين القيد — عشان القيد ما يفشلش على صف قديم.

-- 1) أي خدمة مش «كشف ثم عرض سعر» بيتقفل عندها التقييم بالصور: العلم كان بلا أثر أصلاً،
--    فالقفل مش بيغيّر أي سلوك حقيقي — بس بيخلّي الواجهة تقول الحقيقة.
UPDATE services
   SET remote_assessment_enabled = false
 WHERE remote_assessment_enabled = true
   AND pricing_model <> 'inspection_then_quote';

-- 2) خدمة كانت سياستها «بالصور فقط» وبقت من غير مسار صور = سكتة. بترجع لـ«تحويل بالإدارة»
--    مع تفعيل المعاينة في الموقع، وده المسار الوحيد اللي فعلاً كان شغّال ليها.
UPDATE services
   SET assessment_route_policy = 'admin_triage',
       onsite_assessment_enabled = true
 WHERE assessment_route_policy = 'remote_only'
   AND remote_assessment_enabled = false;

-- 3) خدمة «محتاجة تقييم» فضلت بلا أي مسار بعد التطبيع = نفس السكتة. المعاينة في الموقع هي
--    المسار المتاح لأي طريقة تسعير، فبتتفعّل.
UPDATE services
   SET onsite_assessment_enabled = true
 WHERE price_certainty_mode = 'assessment_required'
   AND remote_assessment_enabled = false
   AND onsite_assessment_enabled = false;

ALTER TABLE services
  ADD CONSTRAINT services_remote_assessment_requires_inspection_model_check
  CHECK (remote_assessment_enabled = false OR pricing_model = 'inspection_then_quote');

ALTER TABLE services
  ADD CONSTRAINT services_assessment_required_needs_a_route_check
  CHECK (
    price_certainty_mode <> 'assessment_required'
    OR remote_assessment_enabled = true
    OR onsite_assessment_enabled = true
  );

ALTER TABLE services
  ADD CONSTRAINT services_route_policy_matches_enabled_routes_check
  CHECK (
    (assessment_route_policy <> 'remote_only' OR remote_assessment_enabled = true)
    AND (assessment_route_policy <> 'onsite_only' OR onsite_assessment_enabled = true)
  );
