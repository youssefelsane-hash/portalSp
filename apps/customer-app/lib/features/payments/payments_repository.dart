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
  String _generateIdempotencyKey() {
    final random = Random();
    return '${DateTime.now().microsecondsSinceEpoch}-${random.nextInt(1 << 32)}';
  }

  Future<Map<String, dynamic>> payWithWallet(String orderId) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-wallet',
      extraHeaders: {'Idempotency-Key': _generateIdempotencyKey()},
    );
    return data!;
  }

  // بيرجّع {payment, redirect_url} — الكولر مسؤول يفتح redirect_url في WebView (نفس نمط
  // "الباك-إند جاهز، مفيش ولا مسؤولية تسوية هنا" — القفل النهائي بيحصل عبر webhook مش رد الـ endpoint ده).
  Future<String> payWithCard(String orderId) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-card',
      extraHeaders: {'Idempotency-Key': _generateIdempotencyKey()},
    );
    return data!['redirect_url'] as String;
  }
}
