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
  }) async {
    final data = await auth.authedRequest('POST', '/orders', body: {
      'service_id': serviceId,
      'address_id': addressId,
      if (problemDescription != null && problemDescription.isNotEmpty)
        'problem_description': problemDescription,
    });
    return Order.fromJson(data!);
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
