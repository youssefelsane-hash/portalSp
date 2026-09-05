import { AssessmentRoutePolicy, PriceCertaintyMode, PricingModel } from './entities/service.entity';

/**
 * **هل إعدادات الخدمة دي بتسيب للعميل طريق يحجز بيه فعلاً؟**
 *
 * ## المشكلة اللي الملف ده موجود عشانها (بلاغ مالك)
 *
 * إعدادات الخدمة بتتحفظ من لوحة الأدمن، ونتيجتها بتظهر في تطبيق تاني خالص. لما التركيبة
 * متناقضة، الأدمن **بيحفظ بنجاح** والعميل **بيتقفل بخطأ** — والأدمن مايعرفش غير من بلاغ عميل.
 *
 * الطلب الصريح: «السيستم يشوف هل الإعدادات دي هترفليكت عند اليوزر بـerror ولا لأ. لو هترفليكت،
 * الـerror يظهر للأدمن وهو بيحط».
 *
 * الملف ده هو الإجابة الواحدة على السؤال ده. **دوال نقية** بلا أي اعتماديات، فنفس القاعدة
 * بالحرف بتتنفّذ في:
 *
 *   • حفظ الأدمن (`admin-catalog.service.ts`) — بترفض التركيبة قبل ما تتحفظ،
 *   • أداة التدقيق (`scripts/audit-booking-flow.js`) — بتمشي على المصفوفة كلها،
 *   • والاختبارات (`service-bookability.spec.ts`) — بتغطي المصفوفة نفسها.
 *
 * القاعدة الحاكمة: **كل تركيبة الأدمن يقدر يحفظها لازم يكون لها مسار حجز واحد على الأقل شغّال
 * عند العميل.** لو مفيش، الحفظ بيترفض برسالة بتقول الناقص إيه بالظبط.
 */

export interface ServiceBookabilityConfig {
  pricingModel: PricingModel;
  priceCertaintyMode: PriceCertaintyMode;
  assessmentRoutePolicy: AssessmentRoutePolicy;
  remoteAssessmentEnabled: boolean;
  onsiteAssessmentEnabled: boolean;
  allowsIndividual: boolean;
  allowsTeam: boolean;
  allowsEmergency: boolean;
  allowsScheduling: boolean;
}

/**
 * مسارات التقييم المتاحة فعلاً للعميل.
 *
 * **ده نفس الاشتقاق الموجود في `assessment-route-guard.ts` وفي العميل (Dart/TS)** — مكتوب هنا
 * بصيغة إيجابية («إيه المتاح») بدل صيغة الرفض، عشان الأدمن يحتاج يعرف «فاضل إيه» مش «ليه اترفض».
 */
export function customerAssessmentRoutes(config: ServiceBookabilityConfig): { remote: boolean; onsite: boolean } {
  if (config.priceCertaintyMode !== PriceCertaintyMode.ASSESSMENT_REQUIRED) {
    return { remote: false, onsite: false };
  }
  return {
    remote:
      config.pricingModel === PricingModel.INSPECTION_THEN_QUOTE &&
      config.remoteAssessmentEnabled &&
      config.assessmentRoutePolicy !== AssessmentRoutePolicy.ONSITE_ONLY,
    onsite:
      config.onsiteAssessmentEnabled &&
      config.assessmentRoutePolicy !== AssessmentRoutePolicy.REMOTE_ONLY,
  };
}

/**
 * كل الأسباب اللي هتخلّي العميل يتقفل على الخدمة دي — فاضية = الإعدادات سليمة.
 *
 * الرسائل بترجع كنصوص مش بتترمي كـexceptions، عشان الدالة تفضل نقية والمنادي هو اللي يقرر
 * يرفض ولا يعرض تحذير.
 */
export function serviceBookabilityIssues(config: ServiceBookabilityConfig): string[] {
  const issues: string[] = [];

  // ① **شكل التنفيذ**: مين اللي هينفّذ الشغل؟ لا فرد ولا فريق = مفيش شكل تنفيذ أصلاً.
  //
  // مكانش عليه أي فحص قبل كده، و`resolveBookingMode()` (ADR-0048) بترجّع `individual`
  // كافتراضي أخير — فالطلب كان بيتعمل بوضع الأدمن قافله بنفسه، والتوزيع بيدوّر على فني
  // لشكل تنفيذ الخدمة مش بتدعمه.
  if (!config.allowsIndividual && !config.allowsTeam) {
    issues.push('لازم تسمح بفني فردي أو فريق — واحد على الأقل، وإلا مفيش شكل تنفيذ للخدمة دي');
  }

  // ② **وقت الحجز**: لا جدولة (بكرة وبعده) ولا طوارئ (النهارده) = مفيش وقت العميل يقدر يختاره.
  if (!config.allowsScheduling && !config.allowsEmergency) {
    issues.push('لازم تسمح بالجدولة أو بالطوارئ — واحد على الأقل، وإلا مفيش وقت العميل يقدر يحجز فيه');
  }

  // ③ **مسار التقييم**: خدمة «محتاجة تقييم» لازم يكون قدام العميل مسار واحد على الأقل.
  //
  // الفحوص التفصيلية (سياسة مثبّتة على مسار مقفول، تقييم بالصور لطريقة تسعير مش كشف-ثم-سعر)
  // موجودة في `applyAssessmentPolicy` برسايلها الخاصة — الفحص هنا هو الشبكة الأخيرة: مهما كان
  // سبب الغياب، خدمة محتاجة تقييم وبلا أي مسار = طريق مسدود.
  if (config.priceCertaintyMode === PriceCertaintyMode.ASSESSMENT_REQUIRED) {
    const routes = customerAssessmentRoutes(config);
    if (!routes.remote && !routes.onsite) {
      issues.push(
        'الخدمة «محتاجة تقييم» ومفيش أي مسار تقييم شغّال للعميل — راجع طريقة التسعير وسياسة المسار والمسارين المفعّلين',
      );
    }
  }

  return issues;
}
