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

  // كانت فجوة موثّقة: مفيش طريقة تسترجع "الطلب النشط الحالي" من غير ما تعرف الـ id مقدماً —
  // بتتنادى وقت فتح الشاشة الرئيسية عشان لو التطبيق اتقفل في نص دورة التنفيذ، نرجّع الفني
  // لشاشة التنفيذ تلقائياً بدل شاشة الطلبات المتاحة. null لو مفيش طلب نشط دلوقتي.
  Future<Order?> getActive() async {
    final data = await authRepository.authedRequest('GET', '/technician/orders/active');
    return data == null ? null : Order.fromJson(data);
  }

  // دورة تنفيذ الطلب بعد القبول — كل فعل بيرجّع نسخة محدّثة من الطلب، الشاشة بتستخدمها
  // تحدد الفعل الجاي (nextTechnicianAction في order.dart) من غير حاجة لـ endpoint تفاصيل منفصل.
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

  // مسار عرض السعر أثناء التنفيذ — الفني بيقترح بنود إضافية (قطعة غيار/أجرة إضافية)، الطلب
  // بيتحول awaiting_quote_approval لحد ما العميل يوافق/يرفض من apps/customer-app.
  Future<Order> proposeQuoteItems(String orderId, List<Map<String, dynamic>> items) async {
    final data = await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/quote-items',
      body: {'items': items},
    );
    final orderJson = data!['order'] as Map<String, dynamic>;
    return Order.fromJson(orderJson);
  }
}
