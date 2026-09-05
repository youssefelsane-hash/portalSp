import { AssessmentRoutePolicy, PriceCertaintyMode, PricingModel } from './entities/service.entity';
import { ServiceBookabilityConfig, customerAssessmentRoutes, serviceBookabilityIssues } from './service-bookability';
import { assessmentRouteRejection } from '../orders/assessment-route-guard';

/**
 * **الطلب الصريح من المالك**: «السيستم يشوف هل الإعدادات دي هترفليكت عند اليوزر بـerror ولا لأ.
 * لو هترفليكت، الـerror يظهر للأدمن وهو بيحط».
 *
 * السبيك ده بيغطي القاعدة دي على المصفوفة كاملة، وبيثبت الحاجة الأهم: **الأدمن والعميل بيوصلوا
 * لنفس الإجابة** — أي تركيبة الأدمن بيقبلها لازم يكون قدام العميل مسار شغّال فيها.
 */
describe('قابلية الحجز — إعدادات الأدمن مقابل ما يقدر عليه العميل', () => {
  const base: ServiceBookabilityConfig = {
    pricingModel: PricingModel.INSPECTION_THEN_QUOTE,
    priceCertaintyMode: PriceCertaintyMode.CONFIRMED_PRICE,
    assessmentRoutePolicy: AssessmentRoutePolicy.ADMIN_TRIAGE,
    remoteAssessmentEnabled: false,
    onsiteAssessmentEnabled: false,
    allowsIndividual: true,
    allowsTeam: false,
    allowsEmergency: false,
    allowsScheduling: true,
  };

  it('الإعداد الافتراضي سليم — مفيش أي اعتراض', () => {
    expect(serviceBookabilityIssues(base)).toEqual([]);
  });

  it('لا فردي ولا فريق = مفيش شكل تنفيذ، والحفظ لازم يترفض', () => {
    const issues = serviceBookabilityIssues({ ...base, allowsIndividual: false, allowsTeam: false });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('فني فردي أو فريق');
  });

  it('لا جدولة ولا طوارئ = مفيش وقت العميل يحجز فيه', () => {
    const issues = serviceBookabilityIssues({ ...base, allowsScheduling: false, allowsEmergency: false });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('الجدولة أو بالطوارئ');
  });

  it('طوارئ لوحدها كافية — خدمة نفس اليوم بس وضع مشروع', () => {
    expect(serviceBookabilityIssues({ ...base, allowsScheduling: false, allowsEmergency: true })).toEqual([]);
  });

  it('الاعتراضات بتتجمع مش بتتوقف عند أول واحد — الأدمن يشوف كل الناقص مرة واحدة', () => {
    const issues = serviceBookabilityIssues({
      ...base, allowsIndividual: false, allowsTeam: false, allowsScheduling: false, allowsEmergency: false,
    });
    expect(issues).toHaveLength(2);
  });

  it('خدمة محتاجة تقييم والمسارين مقفولين = طريق مسدود', () => {
    const issues = serviceBookabilityIssues({ ...base, priceCertaintyMode: PriceCertaintyMode.ASSESSMENT_REQUIRED });
    expect(issues.some((i) => i.includes('مسار تقييم'))).toBe(true);
  });

  /**
   * **الحارس الأهم في الملف ده.** الاشتقاق الإيجابي («إيه المتاح» — للأدمن والعميل) والاشتقاق
   * السلبي («ليه اترفض» — بوابة الطلب) لازم يتفقوا على كل خانة في المصفوفة. أي فرق بينهم بيطلع
   * عند العميل كمسار ظاهر ومرفوض، أو مسار مخفي وشغّال — وده بالظبط شكل البلاغ.
   */
  it('المصفوفة كاملة: «المتاح» و«المرفوض» متطابقين في كل خانة', () => {
    const mismatches: string[] = [];
    for (const pricingModel of Object.values(PricingModel))
      for (const priceCertaintyMode of Object.values(PriceCertaintyMode))
        for (const assessmentRoutePolicy of Object.values(AssessmentRoutePolicy))
          for (const remoteAssessmentEnabled of [false, true])
            for (const onsiteAssessmentEnabled of [false, true]) {
              const config = {
                ...base, pricingModel, priceCertaintyMode, assessmentRoutePolicy,
                remoteAssessmentEnabled, onsiteAssessmentEnabled,
              };
              const routes = customerAssessmentRoutes(config);
              const remoteRejected = assessmentRouteRejection(config, 'remote') !== null;
              const onsiteRejected = assessmentRouteRejection(config, 'onsite') !== null;

              // مسار معروض للعميل ومرفوض من البوابة = طريق مسدود عند التأكيد.
              if (routes.remote && remoteRejected) mismatches.push(`صور معروض ومرفوض: ${JSON.stringify(config)}`);
              if (routes.onsite && onsiteRejected) mismatches.push(`موقع معروض ومرفوض: ${JSON.stringify(config)}`);

              // خدمة محتاجة تقييم والمسار مقبول من البوابة ومش معروض = مسار شغّال العميل مش شايفه.
              if (priceCertaintyMode === PriceCertaintyMode.ASSESSMENT_REQUIRED) {
                if (!routes.onsite && !onsiteRejected) mismatches.push(`موقع مقبول ومش معروض: ${JSON.stringify(config)}`);
              }
            }
    expect(mismatches).toEqual([]);
  });
});
