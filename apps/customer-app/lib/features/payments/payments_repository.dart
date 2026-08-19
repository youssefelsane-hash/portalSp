import 'dart:math';
import '../../core/auth_repository.dart';

class WalletBalance {
  final int balanceCents;

  WalletBalance({required this.balanceCents});

  factory WalletBalance.fromJson(Map<String, dynamic> json) =>
      WalletBalance(balanceCents: json['balance_cents'] as int);
}

class PaymentsRepository {
  final AuthRepository auth;

  PaymentsRepository(this.auth);

  Future<WalletBalance> fetchWallet() async {
    final data = await auth.authedRequest('GET', '/wallet');
    return WalletBalance.fromJson(data!);
  }

  // كل عملية دفع لازم Idempotency-Key حقيقي — مش UUID package (تجنّب اعتماد جديد لسطر واحد)،
  // مزيج timestamp + رقم عشوائي كافي كمفتاح فريد على مستوى الجهاز الواحد لعملية دفع واحدة.
  //
  // بَقّة حقيقية اتلقطت (مراجعة booking flow الشاملة 2026-08-12): الدالة دي كانت بتتنادى من
  // جوّه كل واحدة من الدوال التلاتة تحت، يعني كل نداء (حتى لو retry لنفس الطلب بعد timeout
  // شبكة) كان بيولّد مفتاح جديد كل مرة — يعني الـIdempotency-Key عمليًا كان بيتلغى تمامًا
  // (الباك-إند بيدور على مفتاح موجود قبل كده بنفس القيمة، ومفتاح جديد كل مرة يعني الفحص ده
  // مبيلاقيش حاجة أبداً). الحماية الفعلية من دفع مزدوج فضلت موجودة بس عبر قفل الطلب الذرّي
  // في الباك-إند نفسه (orders.service.ts's payWithWallet)، مش عبر العقد المصمَّم أصلاً. الإصلاح:
  // المفتاح بقى بيتولّد مرة واحدة بس ويتبعت من الكولر (order_detail_screen.dart) — retry لنفس
  // محاولة الدفع بيستخدم نفس المفتاح فعليًا، زي ما العقد مفروض يشتغل بالظبط.
  //
  // بَقّة حقيقية تانية اتلقطت (Script 7 Phase 9 نفسها، ظهرت بس على Flutter Web): `1 << 32`
  // بيتقيّم لـ0 لما التطبيق يتبني بـdart2js/DDC (بعكس الـVM اللي بتحسبها 4294967296 عادي) —
  // `Random().nextInt(0)` بيرمي RangeError فورًا، يعني أي شاشة بتنادي الدالة دي وقت initState
  // (create_order_screen.dart) كانت بتكسر الشاشة كلها بشاشة حمرا قبل ما أي حاجة تترندر خالص
  // (بما فيها الخريطة — مش بَقّة خريطة زي ما بدا في الظاهر). الحد الأقصى بقى `0x7FFFFFFF`
  // (2^31-1) — قيمة آمنة ومتطابقة على كل أهداف الترجمة (VM، dart2js، DDC) بلا أي إزاحة بت كبيرة.
  String generateIdempotencyKey() {
    final random = Random();
    return '${DateTime.now().microsecondsSinceEpoch}-${random.nextInt(0x7FFFFFFF)}';
  }

  Future<Map<String, dynamic>> payWithWallet(String orderId, String idempotencyKey) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-wallet',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return data!;
  }

  // بيرجّع {payment, redirect_url} — الكولر مسؤول يفتح redirect_url في WebView (نفس نمط
  // "الباك-إند جاهز، مفيش ولا مسؤولية تسوية هنا" — القفل النهائي بيحصل عبر webhook مش رد الـ endpoint ده).
  Future<String> payWithCard(String orderId, String idempotencyKey) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-card',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return data!['redirect_url'] as String;
  }

  // بيرجّع كود مرجعي فوري + تاريخ انتهاء — العميل بياخد الكود ويدفعه كاش في أقرب منفذ فوري.
  // مفيش WebView هنا خالص، القفل النهائي بردو عبر webhook مش رد الـ endpoint ده.
  Future<FawryReference> payWithFawryReference(String orderId, String idempotencyKey) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-fawry-reference',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return FawryReference.fromJson(data!);
  }

  // InstaPay — تعليمات تحويل بالعربي + كود مرجعي، مفيش webhook خالص (ADR-0013 §7): موظف Finance
  // بيأكّد الاستلام يدويًا عبر POST /admin/payments/:id/confirm-instapay. مفيش تاريخ انتهاء
  // (بعكس Fawry) — الكود العميل لازم يذكره وقت التحويل عشان الموظف يقدر يربطه بالدفعة الصح.
  Future<InstaPayReference> payWithInstaPay(String orderId, String idempotencyKey) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-instapay',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return InstaPayReference.fromJson(data!);
  }
}

class InstaPayReference {
  final String referenceCode;
  final String instructionsAr;

  InstaPayReference({required this.referenceCode, required this.instructionsAr});

  factory InstaPayReference.fromJson(Map<String, dynamic> json) => InstaPayReference(
        referenceCode: json['reference_code'] as String,
        instructionsAr: json['instructions_ar'] as String,
      );
}

class FawryReference {
  final String referenceNumber;
  final DateTime expiresAt;

  FawryReference({required this.referenceNumber, required this.expiresAt});

  factory FawryReference.fromJson(Map<String, dynamic> json) => FawryReference(
        referenceNumber: json['reference_number'] as String,
        expiresAt: DateTime.parse(json['expires_at'] as String),
      );
}
