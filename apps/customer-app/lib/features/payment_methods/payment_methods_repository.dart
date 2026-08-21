import '../../core/auth_repository.dart';
import 'models.dart';

// كانت فجوة موثّقة صراحة: GET/PATCH/DELETE /payment-methods شغال ومختبر بالكامل في الباك-إند
// (docs/08 §21.3) بلا أي شاشة في customer-app بتستهلكه — العميل معندوش طريقة يشوف كروته
// المحفوظة أو يمسحها أو يغيّر الافتراضية.
class PaymentMethodsRepository {
  final AuthRepository auth;

  PaymentMethodsRepository(this.auth);

  Future<List<SavedPaymentMethod>> list() async {
    final items = await auth.authedRequestList('/payment-methods');
    return items.map(SavedPaymentMethod.fromJson).toList();
  }

  Future<SavedPaymentMethod> setDefault(String id) async {
    final data = await auth.authedRequest('PATCH', '/payment-methods/$id/default');
    return SavedPaymentMethod.fromJson(data!);
  }

  Future<void> revoke(String id) async {
    await auth.authedRequest('DELETE', '/payment-methods/$id');
  }
}
