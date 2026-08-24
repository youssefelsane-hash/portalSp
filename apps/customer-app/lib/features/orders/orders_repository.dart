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

  // Script 2 Part I (findings #46/#47/#48) — كانت شاشة اختيار طريقة الدفع بتعرض 'card'/'instapay'
  // دايمًا بغض النظر عن كون Paymob/InstaPay مُعدّين في الباك-إند فعليًا، فالعميل كان يقدر يختار
  // طريقة الباك-إند هيرفضها بعد ما البحث عن فني يبدأ. بيرجّع set بالطرق المتاحة فعليًا بس.
  Future<Set<String>> fetchAvailablePaymentMethods() async {
    final items = await auth.authedRequestList('/payment-channels');
    return items.where((item) => item['is_available'] == true).map((item) => item['method'] as String).toSet();
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
    // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — ISO 8601 UTC. مستبعد بالكامل من البوكينج طوارئ
    // (الباك-إند بيرفضه صراحة — استجابة فورية بالتعريف).
    String? scheduledAt,
    // "مرن — اختار نطاق أيام" (docs/08 §32.3، طلب مالك صريح 2026-08-20) — لو اتبعت مع scheduledAt،
    // الباك-إند بيختار أقرب يوم فعليًا متاح جوّه النطاق بدل scheduledAt الحرفي.
    String? scheduledAtRangeEnd,
    // إعادة الزيارة تحت الضمان (docs/08 §7) — الطلب الأصلي المكتمل. الباك-إند بيتجاهَل
    // requestedTechnicianId/promoCode/buildingCode/addonIds لو اتبعت مع ده (مجانية بالكامل،
    // بترجع لنفس الفني الأصلي تلقائيًا).
    String? originalOrderId,
    // محرك الإنتاجية (docs/06 §3.3-§3.6) — كانت فجوة موثّقة صراحة: العميل كان بيشوف معاينة المدة
    // بس (CatalogRepository.estimateDuration()) بلا ما القيم دي تتسجّل على الطلب نفسه خالص.
    String? standardDataId,
    num? requestedUnits,
    // دفع قبل التوزيع (ADR-0013 §3/§4، docs/08 §19 بند 1) — 'card' أو 'instapay' بس، أو null
    // (الافتراضي القديم: دفع بعد الشغل زي زمان). لو اتبعت، الباك-إند بيرجّع الطلب بحالة
    // pending_payment بدل searching_technician — الكولر (CreateOrderScreen) لازم يوجّه العميل
    // لشاشة الدفع فورًا بعد ده، التوزيع مش هيبدأ غير بعد ما الدفع يتأكد فعليًا.
    String? paymentMethod,
    // دقة الوقت (ADR-0031 Slice B) + وضع "عدد ساعات بس" (ADR-0032) — إجباري لخدمة
    // service.requiresPreciseSchedule=true أو service.requiresHoursOnly=true بس.
    int? durationHours,
    // وضع "بداية+نهاية" (ADR-0032) — إجباري لخدمة service.requiresStartAndEnd=true بس، ISO 8601 UTC.
    String? scheduledEndAt,
    // "كرّر الحجز ده" (migration 0176) — 'weekly'/'monthly'/'yearly'. الطلب بيتعمل بالمسار العادي
    // زي زمان، وقالب متكرر بيتإنشاء بنفس العملية أول موعد له بعد الموعد المحجوز. الباك-إند بيرفضه
    // للطوارئ/إعادة الزيارة والخدمات غير مفعّل فيها التكرار (allows_recurring_booking=false).
    String? repeatFrequency,
    // Idempotency-Key (docs/01 §1.4، migration 0139، Script 7 Phase 9) — لازم يتولّد مرة واحدة
    // بس من الكولر (CreateOrderScreen، نفس درس generateIdempotencyKey() في
    // payments_repository.dart بالحرف) ويتبعت هنا — أي retry (double-tap، timeout شبكة) بنفس
    // المفتاح يرجّع نفس الطلب الأصلي من الباك-إند بدل ما ينشئ نسخة جديدة.
    required String idempotencyKey,
  }) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
      body: {
      'service_id': serviceId,
      'address_id': addressId,
      if (standardDataId != null) 'standard_data_id': standardDataId,
      if (requestedUnits != null) 'requested_units': requestedUnits,
      if (paymentMethod != null) 'payment_method': paymentMethod,
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
      if (scheduledAt != null) 'scheduled_at': scheduledAt,
      if (scheduledAtRangeEnd != null) 'scheduled_at_range_end': scheduledAtRangeEnd,
      if (durationHours != null) 'duration_hours': durationHours,
      if (scheduledEndAt != null) 'scheduled_end_at': scheduledEndAt,
      if (repeatFrequency != null) 'repeat_frequency': repeatFrequency,
      if (originalOrderId != null) 'original_order_id': originalOrderId,
    });
    return Order.fromJson(data!);
  }

  // تفصيل السعر الكامل قبل تأكيد الحجز (docs/08 §1/§2) — كانت فجوة موثّقة صراحة: الشاشة كانت
  // بتعرض إما basePriceCents الثابت (نموذج fixed، من غير أي تعديل منطقة/طوارئ) أو سعر formula
  // خام من غير رسوم الطوارئ/الفحص أصلاً، من غير الإضافات ولا الخصم مجمّعين في رقم واحد واضح.
  // /orders/preview بيرجّع نفس القيم بالحرف اللي POST /orders هيحسبها فعليًا لو اتبعتت نفس
  // المدخلات (نفس منطق OrdersService.create() بالظبط، اتأكد حي عبر curl مباشر).
  // بَقّة حقيقية اتلقطت واتصلحت: requestedTechnicianId/scheduleSlotId كانوا متاحين في الشاشة
  // (العميل اختار فني/سلوت بالفعل من شاشة اختيار الفني) بس مبيتبعتوش هنا رغم إن create() بيبعتهم
  // فعليًا — يعني معاينة السعر كانت ممكن تفضل بدون مضاعف مستوى الفني، والطلب الفعلي بعدين يتحسب
  // بمضاعف مختلف. الباك-إند بقى بيدعم الاتنين في /orders/preview (نفس منطق create() بالحرف).
  Future<OrderPricePreview> previewPrice({
    required String serviceId,
    required String addressId,
    required BookingMode bookingMode,
    Map<String, dynamic>? fieldValues,
    List<String>? addonIds,
    String? promoCode,
    String? buildingCode,
    String? requestedTechnicianId,
    String? scheduleSlotId,
  }) async {
    final data = await auth.authedRequest('POST', '/orders/preview', body: {
      'service_id': serviceId,
      'address_id': addressId,
      'booking_mode': bookingMode.apiValue,
      if (fieldValues != null && fieldValues.isNotEmpty) 'field_values': fieldValues,
      if (addonIds != null && addonIds.isNotEmpty) 'addon_ids': addonIds,
      if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
      if (buildingCode != null && buildingCode.isNotEmpty) 'building_code': buildingCode,
      if (requestedTechnicianId != null) 'requested_technician_id': requestedTechnicianId,
      if (scheduleSlotId != null) 'schedule_slot_id': scheduleSlotId,
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

  // إعادة جدولة (docs/08 §22 بند 9-12) — بس قبل ما الفني يبدأ يتحرّك، لسلوت تاني لنفس الفني.
  Future<Order> reschedule(String orderId, String newSlotId) async {
    final data = await auth.authedRequest('POST', '/orders/$orderId/reschedule', body: {'new_slot_id': newSlotId});
    return Order.fromJson(data!);
  }

  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — تأكيد العميل بس، مايسوّيش الطلب لوحده
  // (الفني/الأدمن لسه محتاجين يأكدوا الاستلام الفعلي عبر collectCash/adminConfirmCashReceived).
  Future<Order> confirmCashHandover(String orderId) async {
    final data = await auth.authedRequest('POST', '/orders/$orderId/confirm-cash-handover');
    return Order.fromJson(data!);
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

  // سياسة إلغاء الفني (docs/10) — بتتنادى على طلب awaiting_technician_reselection بس. لو
  // requestedTechnicianId اتبعت، أول جولة مطابقة هتحاول تعرض عليه حصريًا (نفس "إعادة الحجز").
  Future<Order> requestRematch(String orderId, {String? requestedTechnicianId}) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/request-rematch',
      body: requestedTechnicianId != null ? {'requested_technician_id': requestedTechnicianId} : null,
    );
    return Order.fromJson(data!);
  }

  // مسار عرض السعر أثناء التنفيذ — الفني بيقترح بنود إضافية (order-items.service.ts)،
  // العميل هنا بيوافق/يرفض. approve/decline بيرجعوا الطلب بحالته الجديدة (in_progress دايماً).
  Future<List<OrderItem>> listQuoteItems(String orderId) async {
    final items = await auth.authedRequestList('/orders/$orderId/quote-items');
    return items.map(OrderItem.fromJson).toList();
  }

  // paymentChoice بس ليه معنى لو الطلب مدفوع مسبقًا إلكترونيًا (order.paymentStatus == 'paid') —
  // 'electronic' (افتراضي) بيطلق تحصيل فوري بوسيلة الدفع المحفوظة، 'cash' بيسيب المبلغ يتجمّع
  // ويتحصّل كاش وقت الاكتمال (docs/08 §22 بند 8). للطلبات الكاش العادية القيمة دي متجاهلة تمامًا.
  Future<Order> approveQuote(String orderId, {String paymentChoice = 'electronic'}) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/quote-items/approve',
      body: {'payment_choice': paymentChoice},
    );
    final orderJson = data!['order'] as Map<String, dynamic>;
    return Order.fromJson(orderJson);
  }

  Future<Order> declineQuote(String orderId) async {
    final data = await auth.authedRequest('POST', '/orders/$orderId/quote-items/decline');
    return Order.fromJson(data!);
  }
}
