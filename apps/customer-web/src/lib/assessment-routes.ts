import type { ServiceDto } from './api-types';

/**
 * مسارات التقييم المتاحة فعلاً لخدمة (docs/08 §124).
 *
 * **بيطابق `apps/api/src/modules/orders/assessment-route-guard.ts` و
 * `apps/customer-app/lib/features/orders/assessment_route.dart` بالحرف.** التلات نسخ لازم
 * تفضل متطابقة — أي فرق بينهم بيطلع كطريق مسدود عند العميل: اختيار ظاهر في الواجهة ومرفوض
 * من الباك-إند، أو العكس.
 *
 * كانت بَقّة حقيقية: `customer-web` كانت بتعرض checkbox «خلّي الإدارة تحدد السعر من الصور»
 * لأي خدمة `inspection_then_quote` بس شرط واحد (`pricing_model`)، بلا أي فحص لسياسة الأدمن —
 * فخدمة سياستها «معاينة في الموقع فقط» كانت بتعرض checkbox مفعّل، والباك-إند يرفضه.
 */
export interface AssessmentRoutes {
  /** تقييم بالصور — العميل بيبعت صور والإدارة بتحدد السعر. */
  remote: boolean;
  /** معاينة في الموقع — فني بيروح، بيعاين، وبيبعت السعر. */
  onsite: boolean;
}

export function assessmentRoutesForService(service: ServiceDto): AssessmentRoutes {
  // خدمة سعرها مؤكد أو بنطاق تقديري مالهاش مسار تقييم أصلاً.
  if (service.price_certainty_mode !== 'assessment_required') {
    return { remote: false, onsite: false };
  }
  const policy = service.assessment_route_policy;
  // التقييم بالصور معناه غياب السعر وقت الحجز — يعني inspection_then_quote بس.
  const remote =
    service.pricing_model === 'inspection_then_quote' &&
    service.remote_assessment_enabled &&
    policy !== 'onsite_only';
  const onsite = service.onsite_assessment_enabled && policy !== 'remote_only';
  return { remote, onsite };
}
