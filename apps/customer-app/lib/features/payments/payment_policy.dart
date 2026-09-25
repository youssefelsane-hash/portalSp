import 'package:flutter/material.dart';

import '../../core/auth_repository.dart';

/// **سياسة دفع/شروط واجبة القبول قبل إتمام العملية** — مصدر واحد لكل مسارات الشروط في التطبيق.
///
/// مطابقة لـ`ApplicablePolicy` في
/// `apps/api/src/modules/payment-policies/payment-policies.service.ts`، ولنفس اللي
/// `apps/customer-web` بيستهلكه بالحرف.
///
/// **ليه موديل واحد**: الموديل ده كان موجود باسم `InstallmentPolicy` جوّه مسار التقسيط بس،
/// فلما احتجنا نفس الحاجة لشروط «الدفع بعد الخدمة» كان الطريق السهل نسخة تانية — وده بالظبط
/// اللي بيخلّي مسار يقبل شرط ومسار يتجاهله بعد أول تعديل.
class PaymentPolicy {
  final String policyId;
  final String titleAr;
  final String bodyAr;
  final bool isRequired;

  /// **النسخة** اللي العميل بيقبلها — مش `policyId`. الباك-إند بيقارن بالنسخة عشان تعديل نص
  /// الشروط يبطّل القبول القديم بدل ما يعدّي بصمت (النسخ immutable).
  final String currentVersionId;

  const PaymentPolicy({
    required this.policyId,
    required this.titleAr,
    required this.bodyAr,
    required this.isRequired,
    required this.currentVersionId,
  });

  factory PaymentPolicy.fromJson(Map<String, dynamic> json) => PaymentPolicy(
        policyId: json['policyId'] as String? ?? '',
        titleAr: json['titleAr'] as String? ?? '',
        bodyAr: json['bodyAr'] as String? ?? '',
        isRequired: json['isRequired'] as bool? ?? true,
        currentVersionId: json['currentVersionId'] as String,
      );
}

/// السياسات المنطبقة على خدمة بعينها.
///
/// `appliesTo` بيفرّق بين مسارات مختلفة تمامًا: `postpaid_service` (الدفع بعد الشغل — بتتفرض
/// وقت إنشاء الطلب) و`installment` (التقسيط — وقت تقديم الطلب).
///
/// **الفشل بيرجّع قايمة فاضية مش استثناء**: ده نداء مساعد، وتعطيل شاشة الحجز كلها لأن نداء
/// الشروط وقع هيبقى ضرر أكبر من نفعه. الباك-إند هو الحارس الحقيقي وهيرفض الطلب برسالة واضحة
/// لو سياسة إجبارية مااتقبلتش.
Future<List<PaymentPolicy>> fetchApplicablePaymentPolicies(
  AuthRepository auth, {
  required String serviceId,
  String appliesTo = 'postpaid_service',
}) async {
  try {
    final items = await auth.authedRequestList(
      '/checkout/payment-policies?applies_to=$appliesTo&service_id=$serviceId',
    );
    return items.map(PaymentPolicy.fromJson).toList();
  } catch (_) {
    return const [];
  }
}

/// **قسم قبول الشروط** — نفس سلوك `apps/customer-web` بالحرف: خانة اختيار **لكل سياسة على حدة**
/// مع نص قابل للفرد.
///
/// مش خانة واحدة لكل الشروط: القبول بيتسجّل بمعرّف نسخة لكل سياسة، وخانة واحدة بتقول للعميل إنه
/// وافق على حاجة واحدة بينما إحنا بنسجّل عليه موافقات متعددة.
class PaymentPoliciesSection extends StatelessWidget {
  final List<PaymentPolicy> policies;
  final Set<String> acceptedVersionIds;
  final ValueChanged<Set<String>> onChanged;
  final String title;

  const PaymentPoliciesSection({
    super.key,
    required this.policies,
    required this.acceptedVersionIds,
    required this.onChanged,
    this.title = 'شروط الدفع',
  });

  @override
  Widget build(BuildContext context) {
    if (policies.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final policy in policies)
          _PolicyTile(
            policy: policy,
            checked: acceptedVersionIds.contains(policy.currentVersionId),
            onToggle: (checked) {
              final next = Set<String>.from(acceptedVersionIds);
              if (checked) {
                next.add(policy.currentVersionId);
              } else {
                next.remove(policy.currentVersionId);
              }
              onChanged(next);
            },
          ),
      ],
    );
  }
}

class _PolicyTile extends StatefulWidget {
  final PaymentPolicy policy;
  final bool checked;
  final ValueChanged<bool> onToggle;

  const _PolicyTile({
    required this.policy,
    required this.checked,
    required this.onToggle,
  });

  @override
  State<_PolicyTile> createState() => _PolicyTileState();
}

class _PolicyTileState extends State<_PolicyTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final policy = widget.policy;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CheckboxListTile(
          value: widget.checked,
          onChanged: (v) => widget.onToggle(v ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          title: Row(
            children: [
              Flexible(child: Text(policy.titleAr)),
              if (policy.isRequired)
                Text(' *', style: TextStyle(color: theme.colorScheme.error)),
            ],
          ),
          subtitle: GestureDetector(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                _expanded ? 'إخفاء الشروط' : 'اقرأ الشروط',
                style: theme.textTheme.bodySmall?.copyWith(
                  decoration: TextDecoration.underline,
                ),
              ),
            ),
          ),
        ),
        if (_expanded)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(policy.bodyAr, style: theme.textTheme.bodySmall),
          ),
      ],
    );
  }
}
