import '../../core/auth_repository.dart';
import 'models.dart';
import 'order.dart';

class OrdersRepository {
  final AuthRepository authRepository;

  OrdersRepository(this.authRepository);

  Future<List<AvailableOrder>> fetchAvailable() async {
    final items = await authRepository.authedRequestList('/technician/orders/available');
    return items.map(AvailableOrder.fromJson).toList();
  }

  Future<Order> accept(String orderId) async {
    final data = await authRepository.authedRequest('POST', '/technician/orders/$orderId/accept');
    return Order.fromJson(data!);
  }

  Future<void> reject(String orderId, {String? reasonCode}) async {
    await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/reject',
      body: reasonCode != null ? {'reason_code': reasonCode} : null,
    );
  }

  // دورة تنفيذ الطلب بعد القبول — كل فعل بيرجّع نسخة محدّثة من الطلب، الشاشة بتستخدمها
  // تحدد الفعل الجاي (nextTechnicianAction في order.dart) من غير حاجة لـ endpoint تفاصيل منفصل
  // (مفيش GET /technician/orders/:id في الباك-إند حالياً — موثّق كفجوة في README).
  Future<Order> depart(String orderId) async {
    final data = await authRepository.authedRequest('POST', '/technician/orders/$orderId/depart');
    return Order.fromJson(data!);
  }

  Future<Order> arrive(String orderId) async {
    final data = await authRepository.authedRequest('POST', '/technician/orders/$orderId/arrive');
    return Order.fromJson(data!);
  }

  Future<Order> start(String orderId) async {
    final data = await authRepository.authedRequest('POST', '/technician/orders/$orderId/start');
    return Order.fromJson(data!);
  }

  Future<Order> complete(String orderId) async {
    final data = await authRepository.authedRequest('POST', '/technician/orders/$orderId/complete');
    return Order.fromJson(data!);
  }

  // تحصيل كاش — أكتر طريقة دفع شائعة في مصر (§11 في الماستر بلان)، بيقفل الطلب فوراً
  // (completed) عكس باقي الأفعال اللي بترجع الطلب بس بحالة وسيطة.
  Future<void> collectCash(String orderId) async {
    await authRepository.authedRequest('POST', '/technician/orders/$orderId/collect-cash');
  }
}
