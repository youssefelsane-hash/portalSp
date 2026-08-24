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
  final List<InstallmentDocRequirement> documentRequirements;

  InstallmentPlan({
    required this.id,
    required this.nameAr,
    required this.installmentCount,
    required this.intervalDays,
    required this.financingPercentage,
    required this.downPaymentPercentage,
    required this.requiresSavedCard,
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

/// خدمة التقسيط — استدعاءات API للعميل
class InstallmentRepository {
  final AuthRepository auth;
  InstallmentRepository(this.auth);

  /// الخطط المتاحة لخدمة معينة
  Future<List<InstallmentPlan>> fetchPlans(String serviceId) async {
    final items = await auth
        .authedRequestList('/installment-plans?service_id=$serviceId');
    return items.map(InstallmentPlan.fromJson).toList();
  }

  /// تقديم طلب تقسيط على طلب موجود
  Future<Map<String, dynamic>> submitApplication({
    required String orderId,
    required String planId,
    required List<String> acceptedPolicyVersionIds,
    String? paymentMethodId,
  }) async {
    return (await auth.authedRequest('POST', '/orders/$orderId/installment-application',
        body: {
          'plan_id': planId,
          if (paymentMethodId != null) 'payment_method_id': paymentMethodId,
          'accepted_policy_version_ids': acceptedPolicyVersionIds,
        }))!;
  }
}
