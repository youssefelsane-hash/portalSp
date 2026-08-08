import '../../core/auth_repository.dart';
import 'models.dart';

class OrdersRepository {
  final AuthRepository authRepository;

  OrdersRepository(this.authRepository);

  Future<List<AvailableOrder>> fetchAvailable() async {
    final items = await authRepository.authedRequestList('/technician/orders/available');
    return items.map(AvailableOrder.fromJson).toList();
  }

  Future<void> accept(String orderId) async {
    await authRepository.authedRequest('POST', '/technician/orders/$orderId/accept');
  }

  Future<void> reject(String orderId, {String? reasonCode}) async {
    await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/reject',
      body: reasonCode != null ? {'reason_code': reasonCode} : null,
    );
  }
}
