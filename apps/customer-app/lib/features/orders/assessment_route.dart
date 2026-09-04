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

/// الحقول اللي بتربط الطلب بمنفّذ بعينه (فني/شركة/سلوت/تذكرة سعر).
///
/// **بتتصفّر كلها مع التقييم بالصور** — والسبب مش تجميلي: الباك-إند بيرفض أي واحدة فيهم مع
/// `request_remote_quote` برسالة «معاينة الفني لا تُجمع مع تقييم الصور أو إعادة الزيارة أو
/// التكرار أو الشركة أو السلوت» (`OrdersService.create()`). والمنطق نفسه: في المسار ده الإدارة
/// بتحدد السعر من الصور، العميل يوافق، **وبعدين** التوزيع بيبدأ — فمفيش منفّذ متحدد وقت الحجز.
///
/// كان طريق مسدود حقيقي عند العميل (بلاغ مالك بلقطة شاشة): يختار «اختاروا لي الأنسب» فتتعمل
/// تذكرة فني، بعدين يختار «الإدارة تحدد السعر من الصور»، فيتقفل عند التأكيد بخطأ أحمر مافيش
/// في الشاشة أي زرار بيلغي التذكرة.
class BookingProviderBinding {
  const BookingProviderBinding({
    this.technicianId,
    this.companyId,
    this.scheduleSlotId,
    this.matchPreviewId,
  });

  final String? technicianId;
  final String? companyId;
  final String? scheduleSlotId;
  final String? matchPreviewId;

  bool get isEmpty =>
      technicianId == null &&
      companyId == null &&
      scheduleSlotId == null &&
      matchPreviewId == null;

  /// نقطة القرار الوحيدة: مع التقييم بالصور مفيش أي ربط بمنفّذ، وبغيره كله بيعدّي زي ما هو.
  static BookingProviderBinding resolve({
    required bool remoteQuote,
    String? technicianId,
    String? companyId,
    String? scheduleSlotId,
    String? matchPreviewId,
  }) => remoteQuote
      ? const BookingProviderBinding()
      : BookingProviderBinding(
          technicianId: technicianId,
          companyId: companyId,
          scheduleSlotId: scheduleSlotId,
          matchPreviewId: matchPreviewId,
        );
}

/// طريقة الدفع اللي تتبعت مع الطلب — القرار ده ثنائي مش «ابعت اللي المستخدم مختاره».
///
/// **بَقّة حقيقية اتلقطت بفحص حي (docs/08 §131)**: التطبيق كان بيبعت `null` لأي طلب تقييم
/// بالصور بلا استثناء، والباك-إند بيرفض بـ«لازم تختار طريقة دفع لرسم التقييم قبل إرسال
/// الصور» لو `remote_assessment_fee_cents > 0`. يعني أي خدمة الأدمن حاطط لها رسم تقييم
/// بالصور كانت **مستحيلة الحجز من التطبيق**: العميل يرفع الصور، يدوس تأكيد، ويترفض في كل مرة.
///
/// والاتجاه التاني من نفس القاعدة مطلوب برضه: رسم = صفر مع طريقة دفع بيترفض بـ«الدفع يتم بعد
/// ما الإدارة تحدد السعر». فالنتيجة الصح لكل حالة:
///   * مسار الصور + رسم > 0  → الطريقة المختارة (لازم تكون إلكترونية).
///   * مسار الصور + رسم = 0  → `null` بالظبط.
///   * مسار عادي              → الطريقة المختارة، ما عدا التقسيط (بيتظبط بعد إنشاء الطلب).
String? bookingPaymentMethod({
  required bool remoteQuote,
  required int remoteAssessmentFeeCents,
  required String? selected,
}) {
  if (remoteQuote) return remoteAssessmentFeeCents > 0 ? selected : null;
  return selected == 'installment' ? null : selected;
}

/// الطرق المسموحة لرسم التقييم بالصور — الكاش مستحيل هنا (مفيش فني رايح يستلمه)، والـDTO
/// في الباك-إند بتقبل التلاتة دول بس.
const kElectronicPaymentMethods = {'card', 'instapay', 'fawry_reference'};
