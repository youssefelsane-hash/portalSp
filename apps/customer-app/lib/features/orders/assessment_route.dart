import '../catalog/models.dart';

/// مسارات التقييم المتاحة فعلاً لخدمة (docs/08 §124).
///
/// **بيطابق `apps/api/src/modules/orders/assessment-route-guard.ts` بالحرف.** لو القاعدة
/// اتغيّرت في ناحية، لازم تتغيّر في التانية — الاختبارات في `test/assessment_route_test.dart`
/// بتغطّي نفس مصفوفة الـ٤ سياسات × مسارين اللي الـspec بتاع الباك-إند بيغطيها، فأي فرق بينهم
/// بيطلع كفشل مش كطريق مسدود عند العميل.
///
/// الفرق ده كان بَقّة حقيقية: التطبيق كان بيعرض «ابعت صور» لأي خدمة معاينة-ثم-سعر، والباك-إند
/// يرفض لو الأدمن قافل التقييم بالصور أو ظابط السياسة «معاينة في الموقع فقط».
class AssessmentRoutes {
  const AssessmentRoutes({required this.remote, required this.onsite});

  /// تقييم بالصور — العميل بيبعت صور والإدارة بتحدد السعر.
  final bool remote;

  /// معاينة في الموقع — فني بيروح، بيعاين، وبيبعت السعر.
  final bool onsite;

  bool get hasChoice => remote && onsite;
  bool get none => !remote && !onsite;

  static AssessmentRoutes forService(CatalogService service) {
    // خدمة سعرها مؤكد أو بنطاق تقديري مالهاش مسار تقييم أصلاً.
    if (service.priceCertaintyMode != 'assessment_required') {
      return const AssessmentRoutes(remote: false, onsite: false);
    }
    final policy = service.assessmentRoutePolicy;
    // التقييم بالصور معناه غياب السعر وقت الحجز — يعني `inspection_then_quote` بس.
    final remote =
        service.pricingModel == 'inspection_then_quote' &&
        service.remoteAssessmentEnabled &&
        policy != 'onsite_only';
    final onsite = service.onsiteAssessmentEnabled && policy != 'remote_only';
    return AssessmentRoutes(remote: remote, onsite: onsite);
  }
}
