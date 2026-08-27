import '../../core/api_client.dart';

/// معلومات الثقة القادمة من السيرفر (`GET /trust-info`، docs/08 §75-ج).
///
/// **الملف ده كان اسمه `trust_strip.dart` وكان جوّاه ودجت شريط ثلاث وعود تحت الخدمات في
/// الشاشة الرئيسية.** الشريط اتشال بالكامل بطلب مالك صريح (docs/08 §76-أ): «اللي إنت لسه
/// كاتبه ضمان شهر والسعر واضح قبل الشغل وفني متحقق — هنشيلها خالص، لأن كده كده موجود فوق
/// أصلاً ضمان على كل شغلنا». وهو محق: تكرار نفس الوعد مرتين في نفس الشاشة بيضعّفه مش بيقوّيه.
///
/// اللي فضل هو **البيانات** — وهي لسه ليها قيمة حقيقية في مكان واحد: شاشة «ضماناتي»، حيث
/// العميل جاي يسأل عن الضمان بالتحديد. النص جاي من السيرفر عشان ما يبقاش رقم ثابت في التطبيق
/// بيتحوّل لكذب أول ما الإدارة تغيّر `warranty.default_days`.
class TrustInfo {
  const TrustInfo({required this.warrantyDays, required this.warrantyLabelAr});

  final int warrantyDays;
  final String warrantyLabelAr;

  factory TrustInfo.fromJson(Map<String, dynamic> json) => TrustInfo(
        warrantyDays: (json['warranty_days'] as num?)?.toInt() ?? 0,
        warrantyLabelAr: json['warranty_label_ar'] as String? ?? 'ضمان على الشغل',
      );
}

/// بيجيب معلومات الثقة. **الفشل بيرجّع `null` مش بيرمي** — معلومة مساعدة ما ينفعش تكسر الشاشة.
Future<TrustInfo?> fetchTrustInfo() async {
  try {
    final data = await apiRequest('GET', '/trust-info');
    return data == null ? null : TrustInfo.fromJson(data);
  } catch (_) {
    return null;
  }
}
