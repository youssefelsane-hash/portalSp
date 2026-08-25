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

  // "شغل متأخر" (docs/08 §56 بند 4) — اتقبل، يومه عدّى، ولسه ما بدأش. كان بيختفي من الشاشة
  // بالكامل (مش "قدامك" لأن معاده فات، ومش "الحالي" غير بالصدفة).
  Future<List<Order>> fetchOverdue() async {
    final items = await authRepository.authedRequestList('/technician/orders/overdue');
    return items.map(Order.fromJson).toList();
  }

  // طلبات شغل إضافي اختيارية (docs/08 §34.1b، ADR-0020) — منفصلة تمامًا عن fetchAvailable()
  // (بث الطوارئ). الفني عنده شغل متوسط/تقيل نفس اليوم لسه بيتعرضله فرصة، بس قبول/رفض صريح
  // بدل تأكيد تلقائي صامت.
  Future<List<WorkOpportunity>> fetchWorkOpportunities() async {
    final items = await authRepository.authedRequestList('/technician/orders/work-opportunities');
    return items.map(WorkOpportunity.fromJson).toList();
  }

  Future<Order> acceptWorkOpportunity(String opportunityId) async {
    final data = await authRepository.authedRequest('POST', '/technician/orders/work-opportunities/$opportunityId/accept');
    return Order.fromJson(data!);
  }

  Future<void> declineWorkOpportunity(String opportunityId) async {
    await authRepository.authedRequest('POST', '/technician/orders/work-opportunities/$opportunityId/decline');
  }

  // تحديث لحظي بعد قرار عرض السعر (docs/08 §15) — بتتنادى لما OrderTrackingGateway يبعت
  // order:status_changed (tracking_client.dart)، عشان نجيب أحدث نسخة كاملة من الطلب بدل ما
  // نبني Order يدوي من حقلين بس (order_status الجديد وحده مش كفاية، محتاجين باقي الحقول كمان).
  Future<Order> getOne(String orderId) async {
    final data = await authRepository.authedRequest('GET', '/technician/orders/$orderId');
    return Order.fromJson(data!);
  }

  Future<List<OrderRescheduleRequest>> listRescheduleRequests(String orderId) async {
    final items = await authRepository.authedRequestList('/technician/orders/$orderId/reschedule-requests');
    return items.map(OrderRescheduleRequest.fromJson).toList();
  }

  Future<OrderRescheduleRequest> requestReschedule(String orderId, {required String newSlotId, required String reason}) async {
    final data = await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/reschedule-requests',
      body: {'new_slot_id': newSlotId, 'reason': reason.trim()},
    );
    return OrderRescheduleRequest.fromJson(data!);
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

  // تجنيد فريق (docs/08 §31/§35، طلب مالك صريح 2026-08-20) — القائد بيدوّر على مرشّحين من
  // مجمع كل الفنيين المتاحين المؤهلين للصنعة (مش بس شركته)، مرتّبين بالمسافة (فريقه الدائم
  // أولاً)، مفلترين برتبة (TechnicianLevel) أقل من أو تساوي رتبته. role إجباري (فني/مساعد) —
  // أي دور القائد بيكمّل دلوقتي.
  Future<List<RecruitCandidate>> fetchRecruitCandidates(String orderId, String role) async {
    final items = await authRepository.authedRequestList('/technician/orders/$orderId/recruit-candidates?role=$role');
    return items.map(RecruitCandidate.fromJson).toList();
  }

  // تجنيد (docs/08 §31/§35) — فني LIGHT بيتضاف فورًا بلا موافقة (زي "معاه مساعد؟")، MEANINGFUL/
  // HEAVY بيتحوّل لفرصة اختيارية (status='offer_sent') بدل تحميل صامت — نفس فلسفة ADR-0020.
  Future<RecruitOutcome> recruitTeamMember(String orderId, String technicianId, String role, {String? roleLabel}) async {
    final data = await authRepository.authedRequest(
      'POST',
      '/technician/orders/$orderId/recruit-candidates/$technicianId',
      body: {
        'role': role,
        if (roleLabel != null && roleLabel.trim().isNotEmpty) 'role_label': roleLabel.trim(),
      },
    );
    final status = data?['status'] as String? ?? 'added';
    final items = (data?['items'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    return RecruitOutcome(
      status: status,
      opportunityId: data?['opportunity_id'] as String?,
      capacityTier: data?['capacity_tier'] as String?,
      items: items.map(TeamMember.fromJson).toList(),
    );
  }

  // دعوات انضمام لفريق (docs/08 §35) — منفصلة عن fetchWorkOpportunities() فوق (أثر القبول مختلف
  // جوهريًا: ينضم كعضو، مش يبقى قائد).
  Future<List<CrewOpportunity>> fetchCrewOpportunities() async {
    final items = await authRepository.authedRequestList('/technician/orders/work-opportunities/crew');
    return items.map(CrewOpportunity.fromJson).toList();
  }

  Future<List<TeamMember>> acceptCrewOpportunity(String opportunityId) async {
    final data = await authRepository.authedRequest('POST', '/technician/orders/work-opportunities/$opportunityId/accept-crew');
    final items = (data?['items'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    return items.map(TeamMember.fromJson).toList();
  }

  Future<void> declineCrewOpportunity(String opportunityId) async {
    await authRepository.authedRequest('POST', '/technician/orders/work-opportunities/$opportunityId/decline-crew');
  }

  // "شغلي كعضو فريق" (docs/08 §31) — طلبات الفني مضاف ليها كعضو، مش قائدها.
  Future<List<Order>> fetchTeamAssigned() async {
    final items = await authRepository.authedRequestList('/technician/orders/team-assigned');
    return items.map(Order.fromJson).toList();
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
