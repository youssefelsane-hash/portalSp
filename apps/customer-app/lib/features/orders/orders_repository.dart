import '../../core/api_client.dart' as api_client;
import '../../core/auth_repository.dart';
import '../catalog/models.dart';
import 'models.dart';

class OrdersRepository {
  final AuthRepository auth;

  OrdersRepository(this.auth);

  // عامة تماماً (@Public() في الباك-إند) — مفيش داعي توكن، نفس نمط الكتالوج.
  Future<List<CancellationReason>> listCancellationReasons() async {
    final items = await api_client.apiRequestList('/cancellation-reasons?applies_to=customer');
    return items.map(CancellationReason.fromJson).toList();
  }

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
    required BookingMode bookingMode,
    String? problemDescription,
    String? promoCode,
    List<String>? addonIds,
    String? requestedTechnicianId,
    String? requestedTechnicianCompanyId,
  }) async {
    final data = await auth.authedRequest('POST', '/orders', body: {
      'service_id': serviceId,
      'address_id': addressId,
      // هيكل الحجز الجديد (docs/06 §1) — الوضع اللي العميل اختاره من BookingModeScreen.
      'booking_mode': bookingMode.apiValue,
      if (problemDescription != null && problemDescription.isNotEmpty)
        'problem_description': problemDescription,
      if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
      if (addonIds != null && addonIds.isNotEmpty) 'addon_ids': addonIds,
      // "إعادة الحجز" — تفضيل بس، الباك-إند بيكمّل بالتوزيع العادي لو الفني مش متاح
      // (تفاصيل في apps/api/src/modules/matching/README.md).
      if (requestedTechnicianId != null) 'requested_technician_id': requestedTechnicianId,
      // "اعتماد" — تفضيل شركة/فريق بعينه، متاح بس مع bookingMode=team (الباك-إند بيرفض غير كده).
      if (requestedTechnicianCompanyId != null) 'requested_technician_company_id': requestedTechnicianCompanyId,
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

  Future<Order> cancel(String orderId, {String? reason, String? cancellationReasonId}) async {
    final body = <String, dynamic>{
      if (reason != null && reason.isNotEmpty) 'reason': reason,
      if (cancellationReasonId != null) 'cancellation_reason_id': cancellationReasonId,
    };
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/cancel',
      body: body.isEmpty ? null : body,
    );
    return Order.fromJson(data!);
  }

  // مسار عرض السعر أثناء التنفيذ — الفني بيقترح بنود إضافية (order-items.service.ts)،
  // العميل هنا بيوافق/يرفض. approve/decline بيرجعوا الطلب بحالته الجديدة (in_progress دايماً).
  Future<List<OrderItem>> listQuoteItems(String orderId) async {
    final items = await auth.authedRequestList('/orders/$orderId/quote-items');
    return items.map(OrderItem.fromJson).toList();
  }

  Future<Order> approveQuote(String orderId) async {
    final data = await auth.authedRequest('POST', '/orders/$orderId/quote-items/approve');
    final orderJson = data!['order'] as Map<String, dynamic>;
    return Order.fromJson(orderJson);
  }

  Future<Order> declineQuote(String orderId) async {
    final data = await auth.authedRequest('POST', '/orders/$orderId/quote-items/decline');
    return Order.fromJson(data!);
  }
}
