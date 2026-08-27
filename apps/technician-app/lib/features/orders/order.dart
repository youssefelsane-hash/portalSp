// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts (OrderAddressResponseDto) —
// لزرار "افتح الملاحة" في شاشة تنفيذ الطلب.
class OrderAddress {
  final String streetName;
  final String? landmark;
  final double latitude;
  final double longitude;

  OrderAddress({
    required this.streetName,
    required this.landmark,
    required this.latitude,
    required this.longitude,
  });

  factory OrderAddress.fromJson(Map<String, dynamic> json) => OrderAddress(
        streetName: json['street_name'] as String,
        landmark: json['landmark'] as String?,
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
      );
}

// تكوين الطاقم الموحّد (docs/08 §35، ADR-0021 §1) — فني/مساعد منفصلين، بتستبدل teamShortage/
// teamMembersNeeded القديمين (كانوا بيتجاهلوا required_assistants تمامًا). مطابق لـ
// OrderTeamService.CrewComposition في الباك-إند.
class CrewStatus {
  final int requiredTechnicians;
  final int requiredAssistants;
  final int assignedTechnicians;
  final int assignedAssistants;
  final int missingTechnicians;
  final int missingAssistants;
  final bool crewComplete;

  CrewStatus({
    required this.requiredTechnicians,
    required this.requiredAssistants,
    required this.assignedTechnicians,
    required this.assignedAssistants,
    required this.missingTechnicians,
    required this.missingAssistants,
    required this.crewComplete,
  });

  factory CrewStatus.fromJson(Map<String, dynamic> json) => CrewStatus(
        requiredTechnicians: json['requiredTechnicians'] as int,
        requiredAssistants: json['requiredAssistants'] as int,
        assignedTechnicians: json['assignedTechnicians'] as int,
        assignedAssistants: json['assignedAssistants'] as int,
        missingTechnicians: json['missingTechnicians'] as int,
        missingAssistants: json['missingAssistants'] as int,
        crewComplete: json['crewComplete'] as bool,
      );
}

// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts — نسخة الفني (منفصلة عن
// AvailableOrder اللي بيرجعها /technician/orders/available، ده الشكل الكامل اللي كل فعل
// (accept/depart/arrive/start/complete) بيرجّعه بعد تنفيذه).
/// docs/08 §71 — سطر واحد من إجابات العميل: "المساحة: 25 م² · الدور: 3". التسميات محلولة من
/// الباك-إند وقت الحجز (snapshot)، فمفيش أي منطق تسمية هنا — بس تجميع للعرض.
String _formatCustomerInputs(dynamic raw) {
  if (raw is! List) return '';
  return raw
      .whereType<Map<String, dynamic>>()
      .map((item) {
        final label = item['label'] as String? ?? '';
        final value = item['value'] as String? ?? '';
        final unit = item['unit'] as String?;
        if (label.isEmpty || value.isEmpty) return '';
        return unit != null && unit.isNotEmpty ? '$label: $value $unit' : '$label: $value';
      })
      .where((part) => part.isNotEmpty)
      .join(' · ');
}

class Order {
  final String id;
  final String orderNumber;
  final String orderStatus;
  final String? problemDescription;
  /// اللي العميل اختاره في الفورم الديناميكي وقت الحجز (docs/08 §71) — نص جاهز للعرض في سطر
  /// واحد، متبني في الباك-إند بتسميات عربية محلولة. فاضي = الخدمة مالهاش حقول ديناميكية.
  final String customerInputsLine;
  // الصورة المالية المسموحة للفني (docs/08 §60.2، طلب مالك صريح). الباك-إند بيفلتر قبل الإرسال —
  // الحقول القديمة (paid_amount_cents، financed_order_amount_cents، installment_outstanding_cents،
  // total_amount_cents وقت وجود دفع أونلاين) **مش بترجع من الـAPI أصلاً**، مش مجرد مخفية هنا.
  //
  // القاعدة: الفني بيشوف الفلوس اللي بتعدّي من إيده وبس — الكاش اللي هيحصّله، ونصيبه هو.
  /** الكاش المطلوب تحصيله من العميل دلوقتي. */
  final int cashToCollectCents;
  /** نصيب الفني من الطلب (بعد نسبة الشركة) — بلا أي شرح لتكوينه. */
  final int myEarningCents;
  /** فيه جزء (أو الكل) اتدفع أونلاين — واقعة بلا رقم. */
  final bool hasOnlinePayment;
  /** كله اتدفع أونلاين ومفيش كاش هيتحصّل. */
  final bool fullyPaidOnline;
  /** الإجمالي — بيرجع من الـAPI بس لما مفيش دفع أونلاين (وقتها = الكاش المطلوب تحصيله). */
  final int? totalAmountCents;
  // docs/08 §64.ب (بلاغ مالك: «نصيبك 0 وده مش منطقي») — السعر لسه ما اتحددش (معاينة/عرض سعر
  // بيتقرر على الطبيعة)، فالرقم صفر **حسابيًا** مش لأن الشغل ببلاش. الفرق ده لازم يبان في النص.
  final bool earningPending;
  // الرقم ده حصّة الفني ده من وعاء الطاقم مش الوعاء كله (ADR-0040).
  final bool isCrewShare;
  final String paymentStatus;
  final OrderAddress? address;
  // "اعتماد" (docs/06 §1) — بس لما يبقى 'team' في الباك-إند (order.entity.ts's BookingMode) فيه
  // مفهوم "طاقم" أصلاً (order_team_members). Script 7 Phase 13/14 — كانت مفقودة تمامًا من نموذج
  // الفني هنا رغم إن الشاشة محتاجاها لعرض "طاقم الطلب".
  final String bookingMode;
  final int? requiredTechnicians;
  // "الشغل المؤكّد قدامي" (docs/08 §165) — null يعني ASAP (اتقبل كطلب فوري، مش مجدول لتاريخ لاحق).
  final String? scheduledAt;
  // تكوين الطاقم (docs/08 §35، ADR-0021 §1) — موجود بس لقائد الطلب على booking_mode='team'
  // (getOne بتحسبه). بيستبدل teamShortage/teamMembersNeeded القديمين بالكامل.
  final CrewStatus? crewStatus;
  // موجود بس لعضو فريق (مش القائد) بيشوف تفاصيل طلب مضاف ليه — "قائد الفريق: <الاسم>".
  final String? teamLeaderName;
  // بيانات العميل والخدمة (docs/08 §56 بند 3) — بلاغ مالك: الفني كان بيشوف أزرار التنفيذ بس،
  // من غير ما يعرف رايح لمين ولا يعمل إيه. اسم/تليفون العميل بيرجعوا من الباك-إند بس بعد تأكيد
  // حجز حقيقي (TECHNICIAN_CONTACT_VISIBLE_STATUSES) — null قبل كده، والواجهة بتخفيهم بدل ما
  // تعرض قيمة فاضية.
  final String? customerName;
  final String? customerPhone;
  final String? serviceNameAr;
  // "جديد عليك" (docs/08 §56 بند 2) — الفني لسه ما فتحش تفاصيل الطلب ولا مرة. بيتحسب في
  // الباك-إند (orders.technician_viewed_at) مش محليًا، فبيفضل صح بعد إعادة تثبيت أو جهاز تاني.
  final bool isNewForTechnician;

  Order({
    required this.id,
    required this.orderNumber,
    required this.orderStatus,
    required this.problemDescription,
    this.customerInputsLine = '',
    required this.cashToCollectCents,
    required this.myEarningCents,
    required this.hasOnlinePayment,
    required this.fullyPaidOnline,
    this.totalAmountCents,
    this.earningPending = false,
    this.isCrewShare = false,
    required this.paymentStatus,
    required this.bookingMode,
    this.requiredTechnicians,
    this.address,
    this.scheduledAt,
    this.crewStatus,
    this.teamLeaderName,
    this.customerName,
    this.customerPhone,
    this.serviceNameAr,
    this.isNewForTechnician = false,
  });

  factory Order.fromJson(Map<String, dynamic> json) => Order(
        id: json['id'] as String,
        orderNumber: json['order_number'] as String,
        orderStatus: json['order_status'] as String,
        problemDescription: json['problem_description'] as String?,
        customerInputsLine: _formatCustomerInputs(json['customer_inputs']),
        cashToCollectCents: json['cash_to_collect_cents'] as int? ?? 0,
        myEarningCents: json['my_earning_cents'] as int? ?? 0,
        hasOnlinePayment: json['has_online_payment'] as bool? ?? false,
        fullyPaidOnline: json['fully_paid_online'] as bool? ?? false,
        totalAmountCents: json['total_amount_cents'] as int?,
        earningPending: json['earning_pending'] as bool? ?? false,
        isCrewShare: json['is_crew_share'] as bool? ?? false,
        paymentStatus: json['payment_status'] as String,
        bookingMode: json['booking_mode'] as String? ?? 'individual',
        requiredTechnicians: json['required_technicians'] as int?,
        address: json['address'] != null
            ? OrderAddress.fromJson(json['address'] as Map<String, dynamic>)
            : null,
        scheduledAt: json['scheduled_at'] as String?,
        crewStatus: json['crew_status'] != null ? CrewStatus.fromJson(json['crew_status'] as Map<String, dynamic>) : null,
        teamLeaderName: json['team_leader_name'] as String?,
        customerName: json['customer_name'] as String?,
        customerPhone: json['customer_phone'] as String?,
        serviceNameAr: json['service_name_ar'] as String?,
        isNewForTechnician: json['is_new_for_technician'] as bool? ?? false,
      );
}

// تسلسل دورة عمل الفني بعد القبول — مطابق لـ order-state-machine.ts بالظبط
// (accepted -> technician_on_way -> technician_arrived -> in_progress -> work_completed).
const Map<String, String> technicianOrderStatusLabelsAr = {
  'accepted': 'قبلت الطلب',
  'technician_on_way': 'في الطريق',
  'technician_arrived': 'وصلت',
  'in_progress': 'الشغل شغّال',
  'awaiting_quote_approval': 'في انتظار موافقة العميل على عرض السعر',
  'work_completed': 'الشغل خلص — محتاج تحصيل',
  'awaiting_payment': 'في انتظار الدفع',
  'completed': 'اتقفل',
  'disputed': 'متوقف — بانتظار مراجعة الإدارة',
};

// الفعل الجاي المتاح لكل حالة — null يعني مفيش فعل تنفيذي جاي (لازم تحصيل كاش أو دفع العميل،
// أو استنى رد العميل على عرض السعر).
const Map<String, String?> nextTechnicianAction = {
  'accepted': 'depart',
  'technician_on_way': 'arrive',
  'technician_arrived': 'start',
  'in_progress': 'complete',
  'work_completed': 'collect_cash',
};

// مطابق لـ apps/api/src/modules/orders/dto/order-item-response.dto.ts
class OrderItem {
  final String id;
  final String itemType;
  final String nameAr;
  final int totalPriceCents;
  final bool isCustomerApproved;

  OrderItem({
    required this.id,
    required this.itemType,
    required this.nameAr,
    required this.totalPriceCents,
    required this.isCustomerApproved,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) => OrderItem(
        id: json['id'] as String,
        itemType: json['item_type'] as String,
        nameAr: json['name_ar'] as String,
        totalPriceCents: json['total_price_cents'] as int,
        isCustomerApproved: json['is_customer_approved'] as bool,
      );
}

const Map<String, String> technicianActionLabelsAr = {
  'depart': 'انطلقت للعنوان',
  'arrive': 'وصلت',
  'start': 'ابدأ الشغل',
  'complete': 'الشغل خلص',
  'collect_cash': 'حصّلت الكاش',
};

/// نص «نصيبك» الموحّد (docs/08 §64.ب).
///
/// بلاغ المالك: «بيقولوا إن نصيبك من صفر، وده مش منطقي». الحساب نفسه كان سليم — العرض هو اللي
/// كان بيكدب: طلب لسه ما اتسعّرش نصيبه بيطلع صفر حسابيًا، و«0 ج.م» معناها للفني «هتشتغل ببلاش».
/// دلوقتي الحالتين منفصلتين بالنص، والحصّة من طاقم بتتقال إنها حصّة مش الإجمالي.
String technicianEarningLabel({
  required int myEarningCents,
  required bool earningPending,
  required bool isCrewShare,
  required String Function(int) formatEgp,
}) {
  if (earningPending) return 'نصيبك: هيتحدد بعد تسعير الشغلانة';
  final amount = formatEgp(myEarningCents);
  return isCrewShare ? 'نصيبك من الطاقم: $amount' : 'نصيبك: $amount';
}
