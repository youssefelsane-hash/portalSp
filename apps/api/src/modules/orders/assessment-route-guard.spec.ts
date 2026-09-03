import { AssessmentRoutePolicy, PriceCertaintyMode, PricingModel } from '../catalog/entities/service.entity';
import { assessmentRouteRejection, type AssessmentRouteConfig } from './assessment-route-guard';

/**
 * مصفوفة الأربع سياسات × مسارين (docs/08 §124) — نفس المصفوفة اللي `apps/customer-app`'s
 * `assessment_route_test.dart` بتغطّيها بالحرف، عشان أي فرق بين النسختين يطلع كفشل اختبار
 * مش كطريق مسدود عند العميل.
 *
 * **بَقّة حقيقية اتلقطت بفحص حي**: سياسة `remote_only` كانت بتقفل مسار الصور بس، ومسار
 * المعاينة في الموقع كان يعدّي بلا أي فحص — رسم كشف بيتحصّل وفني بيتبعت لخدمة الأدمن قافل
 * فيها المعاينة صراحة. الاختبارات دي بتثبت الاتجاهين مع بعض.
 */
function config(overrides: Partial<AssessmentRouteConfig> = {}): AssessmentRouteConfig {
  return {
    pricingModel: PricingModel.INSPECTION_THEN_QUOTE,
    priceCertaintyMode: PriceCertaintyMode.ASSESSMENT_REQUIRED,
    assessmentRoutePolicy: AssessmentRoutePolicy.ADMIN_TRIAGE,
    remoteAssessmentEnabled: true,
    onsiteAssessmentEnabled: true,
    ...overrides,
  };
}

describe('assessmentRouteRejection() — مصفوفة سياسات التقييم', () => {
  it('سعر مؤكد أو نطاق تقديري: مسار المعاينة مسموح دايمًا (مفيش سياسة تقييم أصلاً)', () => {
    const c = config({ priceCertaintyMode: PriceCertaintyMode.CONFIRMED_PRICE });
    expect(assessmentRouteRejection(c, 'onsite')).toBeNull();
  });

  describe('admin_triage — المسارين مفعّلين', () => {
    const c = config({ assessmentRoutePolicy: AssessmentRoutePolicy.ADMIN_TRIAGE });
    it('الصور مسموحة', () => expect(assessmentRouteRejection(c, 'remote')).toBeNull());
    it('المعاينة مسموحة', () => expect(assessmentRouteRejection(c, 'onsite')).toBeNull());
  });

  describe('remote_only — بالصور بس', () => {
    const c = config({ assessmentRoutePolicy: AssessmentRoutePolicy.REMOTE_ONLY });
    it('الصور مسموحة', () => expect(assessmentRouteRejection(c, 'remote')).toBeNull());
    it('المعاينة في الموقع مرفوضة — البَقّة الحقيقية اللي اتصلحت', () => {
      expect(assessmentRouteRejection(c, 'onsite')).not.toBeNull();
    });
  });

  describe('onsite_only — معاينة بس', () => {
    const c = config({ assessmentRoutePolicy: AssessmentRoutePolicy.ONSITE_ONLY });
    it('الصور مرفوضة', () => expect(assessmentRouteRejection(c, 'remote')).not.toBeNull());
    it('المعاينة مسموحة', () => expect(assessmentRouteRejection(c, 'onsite')).toBeNull());
  });

  describe('customer_choice — زي admin_triage بالظبط', () => {
    const c = config({ assessmentRoutePolicy: AssessmentRoutePolicy.CUSTOMER_CHOICE });
    it('الصور مسموحة', () => expect(assessmentRouteRejection(c, 'remote')).toBeNull());
    it('المعاينة مسموحة', () => expect(assessmentRouteRejection(c, 'onsite')).toBeNull());
  });

  it('علم الصور مقفول من غير السياسة: مسار الصور مرفوض برضه', () => {
    const c = config({ remoteAssessmentEnabled: false });
    expect(assessmentRouteRejection(c, 'remote')).not.toBeNull();
  });

  it('علم المعاينة مقفول من غير السياسة: مسار المعاينة مرفوض برضه', () => {
    const c = config({ onsiteAssessmentEnabled: false });
    expect(assessmentRouteRejection(c, 'onsite')).not.toBeNull();
  });

  it('formula: مسار الصور مرفوض حتى لو العلم شغّال — التقييم بالصور معناه غياب السعر', () => {
    const c = config({ pricingModel: PricingModel.FORMULA });
    expect(assessmentRouteRejection(c, 'remote')).not.toBeNull();
  });

  it('خدمة formula عادية: مسار المعاينة مسموح بلا شرط تقييم (مفيش assessment_required)', () => {
    const c = config({ pricingModel: PricingModel.FORMULA, priceCertaintyMode: PriceCertaintyMode.CONFIRMED_PRICE });
    expect(assessmentRouteRejection(c, 'onsite')).toBeNull();
  });
});
