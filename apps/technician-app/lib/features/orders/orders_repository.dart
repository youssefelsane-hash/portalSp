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

  // سياسة إلغاء الفني (docs/10) — استشاري بس قبل ما نعرض زرار "إلغاء"، الباك-إند بيفرض
  // الحقيقة جوّه cancel() بغض النظر عن الرد هنا.
  Future<CancellationPolicy> fetchCancellationPolicy(String orderId) async {
    final data = await authRepository.authedRequest('GET', '/technician/orders/$orderId/cancellation-policy');
    return CancellationPolicy.fromJson(data!);
  }

  Future<List<CancellationReason>> fetchCancellationReasons() async {
    final items = await authRepository.authedRequestList('/cancellation-reasons?applies_to=technician');
    return items.map(CancellationReason.fromJson).toList();
  }

  // سبب إجباري (كود + نص حر لو السبب محتاجه) — الطلب بعد الإلغاء بيرجع searching_technician
  // (إعادة مطابقة تلقائية) أو awaiting_technician_reselection (يستني اختيار العميل)، مش بيتلغي
  // نهائي أبدًا. تفاصيل كاملة في apps/api/src/modules/orders/README.md § سياسة إلغاء الفني.
  Future<Order> cancel(String orderId, {required String cancellationReasonId, String? reason}) async {
    final data = await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/cancel',
      body: {
        'cancellation_reason_id': cancellationReasonId,
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
    );
    return Order.fromJson(data!);
  }

  // كانت فجوة موثّقة: مفيش طريقة تسترجع "الطلب النشط الحالي" من غير ما تعرف الـ id مقدماً —
  // بتتنادى وقت فتح الشاشة الرئيسية عشان لو التطبيق اتقفل في نص دورة التنفيذ، نرجّع الفني
  // لشاشة التنفيذ تلقائياً بدل شاشة الطلبات المتاحة. null لو مفيش طلب نشط دلوقتي.
  Future<Order?> getActive() async {
    final data = await authRepository.authedRequest('GET', '/technician/orders/active');
    return data == null ? null : Order.fromJson(data);
  }

  // "الشغل المؤكّد قدامي" (docs/08 §165) — طلبات مجدولة مستقبلية اتأكّدت تلقائيًا (بلا قرار
  // قبول/رفض من الفني — الفرق الجوهري بين طلب مجدول بعيد وطلب قريب في fetchAvailable() فوق).
  Future<List<Order>> fetchUpcomingConfirmed() async {
    final items = await authRepository.authedRequestList('/technician/orders/upcoming-confirmed');
    return items.map(Order.fromJson).toList();
  }

  // تحديث لحظي بعد قرار عرض السعر (docs/08 §15) — بتتنادى لما OrderTrackingGateway يبعت
  // order:status_changed (tracking_client.dart)، عشان نجيب أحدث نسخة كاملة من الطلب بدل ما
  // نبني Order يدوي من حقلين بس (order_status الجديد وحده مش كفاية، محتاجين باقي الحقول كمان).
  Future<Order> getOne(String orderId) async {
    final data = await authRepository.authedRequest('GET', '/technician/orders/$orderId');
    return Order.fromJson(data!);
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

  // زيارة فاشلة/عدم حضور (docs/08 §22 بند 3+6) — الفني بيوقف بدل ما يكمّل شغل غير مصرّح أو
  // يقفل "مكتمل" كاذبة. الطلب يتحول disputed ويوديه لمراجعة أدمن حقيقية.
  Future<Order> reportFailedVisit(String orderId, {required String reason, required String description}) async {
    final data = await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/report-failed-visit',
      body: {'reason': reason, 'description': description},
    );
    return Order.fromJson(data!);
  }

  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — الفني بيبلّغ إنه ماستلمش الفلوس (رغم إن
  // العميل ممكن يكون أكّد إنه سلّم). الطلب يتحول disputed برضه، مراجعة أدمن حقيقية (نفس نمط
  // reportFailedVisit فوق) بدل ما نديله قرار نهائي فوري.
  Future<Order> reportCashNotReceived(String orderId, {required String description}) async {
    final data = await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/cash-not-received',
      body: {'description': description},
    );
    return Order.fromJson(data!);
  }

  // طاقم الطلب (docs/08 §5) — كانت فجوة موثّقة صراحة (Script 7 Phase 13/14): الباك-إند عنده
  // GET .../team-members جاهزة ومؤمّنة بالفعل (ownership check ضد IDOR) بس التطبيق ما كانش
  // بيستخدمها خالص. بس لطلبات booking_mode='team'.
  Future<List<TeamMember>> fetchTeamMembers(String orderId) async {
    final items = await authRepository.authedRequestList('/technician/orders/$orderId/team-members');
    return items.map(TeamMember.fromJson).toList();
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
