import { AssessmentRoutePolicy, PriceCertaintyMode, PricingModel } from '../catalog/entities/service.entity';

/**
 * هل المسار اللي العميل طالبه مسموح لسياسة تقييم الخدمة؟ (docs/08 §124، ADR-0063/0066)
 *
 * دالة نقية لأن نفس الإجابة محتاجة في مسارين على الأقل: `OrdersService.create()` و
 * `previewPrice()`. الملف بتاعهم فيه تحذير مكتوب صراحة إن أي تعديل في منطق واحد لازم يتعدّل في
 * التاني بالتوازي — وده بالظبط اللي خلّى الفحص التالي ممكن يحصل، فالقاعدة اتنقلت لمكان واحد
 * بدل ما تتكرر.
 *
 * **بَقّة حقيقية اتلقطت بفحص حي للمصفوفة كاملة (٤ سياسات × مسارين)**: سياسة «تقييم بالصور فقط»
 * (`remote_only`) كانت بترفض... **حاجة واحدة بس**: طلب صور لخدمة مقفولة الصور. المسار التاني —
 * إن العميل يحجز **معاينة في الموقع** لخدمة سياستها «بالصور فقط» — مكانش عليه أي فحص خالص:
 * الطلب كان بيتعمل، ورسم الكشف بيتحصّل (١٥٠ ج في الفحص)، وفني بيتبعتله فعلاً. يعني الأدمن
 * بيظبط «بالصور بس» والمنصة بتبعت فني على الأرض — خرق مباشر للسياسة، وتكلفة حقيقية.
 *
 * الجهة التانية من نفس البَقّة: `onsite_assessment_enabled = false` مع سياسة `admin_triage`
 * كان معناه المعاينة مقفولة، ومع ذلك الطلب كان يعدّي.
 */
export type AssessmentRoute = 'remote' | 'onsite';

export interface AssessmentRouteConfig {
  pricingModel: PricingModel;
  priceCertaintyMode: PriceCertaintyMode;
  assessmentRoutePolicy: AssessmentRoutePolicy;
  remoteAssessmentEnabled: boolean;
  onsiteAssessmentEnabled: boolean;
}

/**
 * بيرجّع رسالة رفض بالعربي، أو `null` لو المسار مسموح.
 *
 * الرسالة بترجع مش بتترمي كـexception عشان الدالة تفضل نقية وقابلة للاختبار بلا أي infra.
 */
export function assessmentRouteRejection(
  config: AssessmentRouteConfig,
  route: AssessmentRoute,
): string | null {
  if (route === 'remote') {
    // التقييم بالصور بيتطلب غياب السعر وقت الحجز — ده معنى `inspection_then_quote` نفسه.
    if (config.pricingModel !== PricingModel.INSPECTION_THEN_QUOTE) {
      return 'طلب تسعير الإدارة بالصور متاح فقط للخدمات من نوع معاينة ثم سعر';
    }
    if (!config.remoteAssessmentEnabled) {
      return 'التقييم بالصور غير متاح لهذه الخدمة — يلزم حجز معاينة في الموقع';
    }
    if (config.assessmentRoutePolicy === AssessmentRoutePolicy.ONSITE_ONLY) {
      return 'الخدمة دي سياستها معاينة في الموقع فقط — التقييم بالصور غير متاح';
    }
    return null;
  }

  // مسار المعاينة في الموقع. الفحص هنا مقصور على الخدمات اللي الأدمن ظبط لها سياسة تقييم
  // فعلاً (`assessment_required`) — أي خدمة تانية مالهاش «مسار تقييم» أصلاً فمفيش حاجة تتفحص،
  // وإضافة أي شرط عليها كان هيكسر كل الحجوزات العادية.
  if (config.priceCertaintyMode !== PriceCertaintyMode.ASSESSMENT_REQUIRED) return null;

  if (config.assessmentRoutePolicy === AssessmentRoutePolicy.REMOTE_ONLY) {
    return 'الخدمة دي سياستها تقييم بالصور فقط — ابعت صور المشكلة عشان الإدارة تحدد السعر';
  }
  if (!config.onsiteAssessmentEnabled) {
    return 'المعاينة في الموقع غير متاحة لهذه الخدمة — ابعت صور المشكلة عشان الإدارة تحدد السعر';
  }
  return null;
}
