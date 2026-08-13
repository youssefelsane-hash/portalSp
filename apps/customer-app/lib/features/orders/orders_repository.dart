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
    // نظام العمائر (docs/08 §13, ADR-0003) — كود بديل لـpromoCode (مش الاتنين مع بعض، الباك-إند
    // بيرفض غير كده). الكود ده اللي رمز QR بتاع بوابة العمارة بيرمّزه — إدخال يدوي هنا (مش مسح
    // كاميرا فعلي) لنفس السبب اللي خلّى إحداثيات GPS إدخال يدوي: مفيش جهاز/إيموليتور حقيقي في
    // بيئة السيشن دي لاختبار إذن الكاميرا حياً، فإضافة مكتبة مسح QR كانت هتبقى وهم أمان مش ميزة
    // مختبرة فعليًا.
    String? buildingCode,
    List<String>? addonIds,
    String? requestedTechnicianId,
    String? requestedTechnicianCompanyId,
    // محرك التسعير الديناميكي (docs/08 §1) — لازم لخدمات pricing_model=formula بس، القيم اللي
    // العميل ملاها في الفورم الديناميكي (CreateOrderScreen._buildPricingFieldWidget).
    Map<String, dynamic>? fieldValues,
    // الجدولة الحقيقية للفني (docs/08 §2-§3) — سلوت `available` محدد من جدول فني بعينه، اختاره
    // العميل في TechnicianProfileScreen. أقوى من requestedTechnicianId (الفني نفسه أعلن التوافر
    // في الوقت ده صراحة) — الباك-إند بيستنتج الفني منها تلقائيًا.
    String? scheduleSlotId,
    // إعادة الزيارة تحت الضمان (docs/08 §7) — الطلب الأصلي المكتمل. الباك-إند بيتجاهَل
    // requestedTechnicianId/promoCode/buildingCode/addonIds لو اتبعت مع ده (مجانية بالكامل،
    // بترجع لنفس الفني الأصلي تلقائيًا).
    String? originalOrderId,
    // محرك الإنتاجية (docs/06 §3.3-§3.6) — كانت فجوة موثّقة صراحة: العميل كان بيشوف معاينة المدة
    // بس (CatalogRepository.estimateDuration()) بلا ما القيم دي تتسجّل على الطلب نفسه خالص.
    String? standardDataId,
    num? requestedUnits,
  }) async {
    final data = await auth.authedRequest('POST', '/orders', body: {
      'service_id': serviceId,
      'address_id': addressId,
      if (standardDataId != null) 'standard_data_id': standardDataId,
      if (requestedUnits != null) 'requested_units': requestedUnits,
      // هيكل الحجز الجديد (docs/06 §1) — الوضع اللي العميل اختاره من BookingModeScreen.
      'booking_mode': bookingMode.apiValue,
      if (problemDescription != null && problemDescription.isNotEmpty)
        'problem_description': problemDescription,
      if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
      if (buildingCode != null && buildingCode.isNotEmpty) 'building_code': buildingCode,
      if (addonIds != null && addonIds.isNotEmpty) 'addon_ids': addonIds,
      // "إعادة الحجز" — تفضيل بس، الباك-إند بيكمّل بالتوزيع العادي لو الفني مش متاح
      // (تفاصيل في apps/api/src/modules/matching/README.md).
      if (requestedTechnicianId != null) 'requested_technician_id': requestedTechnicianId,
      // "اعتماد" — تفضيل شركة/فريق بعينه، متاح بس مع bookingMode=team (الباك-إند بيرفض غير كده).
      if (requestedTechnicianCompanyId != null) 'requested_technician_company_id': requestedTechnicianCompanyId,
      if (fieldValues != null && fieldValues.isNotEmpty) 'field_values': fieldValues,
      if (scheduleSlotId != null) 'schedule_slot_id': scheduleSlotId,
      if (originalOrderId != null) 'original_order_id': originalOrderId,
    });
    return Order.fromJson(data!);
  }

  // تفصيل السعر الكامل قبل تأكيد الحجز (docs/08 §1/§2) — كانت فجوة موثّقة صراحة: الشاشة كانت
  // بتعرض إما basePriceCents الثابت (نموذج fixed، من غير أي تعديل منطقة/طوارئ) أو سعر formula
  // خام من غير رسوم الطوارئ/الفحص أصلاً، من غير الإضافات ولا الخصم مجمّعين في رقم واحد واضح.
  // /orders/preview بيرجّع نفس القيم بالحرف اللي POST /orders هيحسبها فعليًا لو اتبعتت نفس
  // المدخلات (نفس منطق OrdersService.create() بالظبط، اتأكد حي عبر curl مباشر).
  Future<OrderPricePreview> previewPrice({
    required String serviceId,
    required String addressId,
    required BookingMode bookingMode,
    Map<String, dynamic>? fieldValues,
    List<String>? addonIds,
    String? promoCode,
    String? buildingCode,
  }) async {
    final data = await auth.authedRequest('POST', '/orders/preview', body: {
      'service_id': serviceId,
      'address_id': addressId,
      'booking_mode': bookingMode.apiValue,
      if (fieldValues != null && fieldValues.isNotEmpty) 'field_values': fieldValues,
      if (addonIds != null && addonIds.isNotEmpty) 'addon_ids': addonIds,
      if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
      if (buildingCode != null && buildingCode.isNotEmpty) 'building_code': buildingCode,
    });
    return OrderPricePreview.fromJson(data!);
  }

  // تقييم متقدم + صور بعد الخدمة (docs/08 §9) — كانت فجوة موثّقة صراحة: العميل مكانش يقدر
  // يشوف صور "قبل/بعد" الطلب أصلاً عشان يختار منها وقت التقييم (after_photo_media_ids).
  Future<List<OrderMedia>> fetchMedia(String orderId) async {
    final items = await auth.authedRequestList('/orders/$orderId/media');
    return items.map(OrderMedia.fromJson).toList();
  }

  // توزيع أدوار الفريق (docs/08 §5) — كانت فجوة موثّقة صراحة: الـendpoint موجود من زمان بس
  // مفيش UI كان بينادي عليه. مفيد بس لطلبات booking_mode=team، بيرجع قايمة فاضية غير كده.
  Future<List<TeamMember>> fetchTeamMembers(String orderId) async {
    final items = await auth.authedRequestList('/orders/$orderId/team-members');
    return items.map(TeamMember.fromJson).toList();
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
