import '../../core/auth_repository.dart';

// نموذج خطة التقسيط — مطابق لرد GET /installment-plans?service_id=
class InstallmentPlan {
  final String id;
  final String nameAr;
  final int installmentCount;
  final int intervalDays;
  final double financingPercentage;
  final double downPaymentPercentage;
  final bool requiresSavedCard;
  final String allowedProvider;
  final List<InstallmentDocRequirement> documentRequirements;

  InstallmentPlan({
    required this.id,
    required this.nameAr,
    required this.installmentCount,
    required this.intervalDays,
    required this.financingPercentage,
    required this.downPaymentPercentage,
    required this.requiresSavedCard,
    required this.allowedProvider,
    required this.documentRequirements,
  });

  factory InstallmentPlan.fromJson(Map<String, dynamic> json) => InstallmentPlan(
        id: json['id'] as String,
        nameAr: json['name_ar'] as String,
        installmentCount: json['installment_count'] as int,
        intervalDays: json['interval_days'] as int? ?? 30,
        financingPercentage:
            (json['financing_percentage'] as num?)?.toDouble() ?? 0,
        downPaymentPercentage:
            (json['down_payment_percentage'] as num?)?.toDouble() ?? 0,
        requiresSavedCard: json['requires_saved_card'] as bool? ?? true,
        allowedProvider: json['allowed_provider'] as String? ?? 'paymob',
        documentRequirements: (json['document_requirements'] as List<dynamic>?)
                ?.map((d) => InstallmentDocRequirement.fromJson(d))
                .toList() ??
            [],
      );
}

class InstallmentDocRequirement {
  final String docType;
  final String labelAr;

  InstallmentDocRequirement({required this.docType, required this.labelAr});

  factory InstallmentDocRequirement.fromJson(Map<String, dynamic> json) =>
      InstallmentDocRequirement(
        docType: json['doc_type'] as String,
        labelAr: json['label_ar'] as String,
      );
}

class InstallmentPolicy {
  final String titleAr;
  final String bodyAr;
  final bool isRequired;
  final String currentVersionId;

  InstallmentPolicy({required this.titleAr, required this.bodyAr, required this.isRequired, required this.currentVersionId});

  factory InstallmentPolicy.fromJson(Map<String, dynamic> json) => InstallmentPolicy(
        titleAr: json['titleAr'] as String,
        bodyAr: json['bodyAr'] as String,
        isRequired: json['isRequired'] as bool? ?? true,
        currentVersionId: json['currentVersionId'] as String,
      );
}

/// نتيجة فحص أهلية التقسيط لطلب — مطابقة لرد GET /orders/:id/installment-options
class InstallmentOptions {
  final bool eligible;

  /// كود السبب من الباك-إند (`amount_out_of_range` / `application_pending` / …) — الواجهة
  /// بتقرر بيه، **مش** بمطابقة النص العربي اللي بيتغيّر بالصياغة.
  final String? reasonCode;
  final String? reasonAr;
  final List<InstallmentPlan> plans;

  const InstallmentOptions({
    required this.eligible,
    this.reasonCode,
    this.reasonAr,
    required this.plans,
  });

  /// الأسباب اللي تخصّ **حالة العميل على الطلب ده** — دي اللي تستاهل سطر يظهرله. باقي الأسباب
  /// (مبلغ بره الحدود، سعر لسه ما اتحددش، التقسيط موقوف) معناها ببساطة "مفيش تقسيط هنا"،
  /// والبانر المفروض يختفي تمامًا (docs/08 §64.ز).
  bool get hasCustomerFacingStatus =>
      reasonCode == 'application_pending' || reasonCode == 'application_approved';

  factory InstallmentOptions.fromJson(Map<String, dynamic> json) => InstallmentOptions(
        eligible: json['eligible'] as bool? ?? false,
        reasonCode: json['reason_code'] as String?,
        reasonAr: json['reason_ar'] as String?,
        plans: (json['plans'] as List<dynamic>?)
                ?.map((p) => InstallmentPlan.fromJson(p as Map<String, dynamic>))
                .toList() ??
            const [],
      );

  static const empty = InstallmentOptions(eligible: false, plans: []);
}

/// خدمة التقسيط — استدعاءات API للعميل
class InstallmentRepository {
  final AuthRepository auth;
  InstallmentRepository(this.auth);

  /// الخطط المتاحة لخدمة معينة (قبل الحجز — مفيش طلب لسه)
  Future<List<InstallmentPlan>> fetchPlans(String serviceId) async {
    final items = await auth
        .authedRequestList('/installment-plans?service_id=$serviceId');
    return items.map(InstallmentPlan.fromJson).toList();
  }

  /// أهلية التقسيط **لطلب بعينه** (docs/08 §64.ز).
  ///
  /// `fetchPlans` بترد على «الخدمة عليها خطط؟» — سؤال مختلف عن «الطلب ده ينفع يتقسّط؟». استخدام
  /// الأولى في شاشة تفاصيل الطلب هو اللي كان بيخلّي البانر معلّق فوق وأي خطة تختارها ترفض.
  Future<InstallmentOptions> fetchOptionsForOrder(String orderId) async {
    final json = await auth.authedRequest('GET', '/orders/$orderId/installment-options');
    return InstallmentOptions.fromJson(json ?? const {});
  }

  Future<List<InstallmentPolicy>> fetchPolicies(String serviceId) async {
    final items = await auth.authedRequestList(
        '/checkout/payment-policies?applies_to=installment&service_id=$serviceId');
    return items.map(InstallmentPolicy.fromJson).toList();
  }

  /// تقديم طلب تقسيط على طلب موجود
  Future<Map<String, dynamic>> submitApplication({
    required String orderId,
    required String planId,
    required List<String> acceptedPolicyVersionIds,
    String? paymentMethodId,
  }) async {
    final body = <String, dynamic>{
      'plan_id': planId,
      'accepted_policy_version_ids': acceptedPolicyVersionIds,
    };
    if (paymentMethodId != null) {
      body['payment_method_id'] = paymentMethodId;
    }
    return (await auth.authedRequest('POST', '/orders/$orderId/installment-application',
        body: body))!;
  }
}
