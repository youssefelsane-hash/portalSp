import '../../core/auth_repository.dart';
import 'models.dart';

class OrdersRepository {
  final AuthRepository auth;

  OrdersRepository(this.auth);

  Future<List<Order>> list() async {
    final items = await auth.authedRequestList('/orders');
    return items.map(Order.fromJson).toList();
  }

  Future<Order> getOne(String orderId) async {
    final data = await auth.authedRequest('GET', '/orders/$orderId');
    return Order.fromJson(data!);
  }

  Future<Order> create({
    required String serviceId,
    required String addressId,
    String? problemDescription,
    String? promoCode,
  }) async {
    final data = await auth.authedRequest('POST', '/orders', body: {
      'service_id': serviceId,
      'address_id': addressId,
      if (problemDescription != null && problemDescription.isNotEmpty)
        'problem_description': problemDescription,
      if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
    });
    return Order.fromJson(data!);
  }

  // معاينة خصم كود قبل الحجز — /promo-codes/:code/validate عامة بس محتاجة توكن عادي
  // (مش Public()، أي مستخدم مسجّل). بترجع الكود والخصم بالقرش لو الكود صالح.
  Future<Map<String, dynamic>> validatePromoCode({
    required String code,
    required String serviceId,
    required String addressId,
  }) async {
    final data = await auth.authedRequest(
      'GET',
      '/promo-codes/$code/validate?service_id=$serviceId&address_id=$addressId',
    );
    return data!;
  }

  Future<Order> cancel(String orderId, {String? reason}) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/cancel',
      body: reason != null && reason.isNotEmpty ? {'reason': reason} : null,
    );
    return Order.fromJson(data!);
  }
}
