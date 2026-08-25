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
class Order {
  final String id;
  final String orderNumber;
  final String orderStatus;
  final String? problemDescription;
  final int totalAmountCents;
  final int paidAmountCents;
  final int financedOrderAmountCents;
  final int refundedAmountCents;
  final int installmentOutstandingCents;
  final int amountDueToTechnicianCents;
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

  Order({
    required this.id,
    required this.orderNumber,
    required this.orderStatus,
    required this.problemDescription,
    required this.totalAmountCents,
    required this.paidAmountCents,
    required this.financedOrderAmountCents,
    required this.refundedAmountCents,
    required this.installmentOutstandingCents,
    required this.amountDueToTechnicianCents,
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
  });

  factory Order.fromJson(Map<String, dynamic> json) => Order(
        id: json['id'] as String,
        orderNumber: json['order_number'] as String,
        orderStatus: json['order_status'] as String,
        problemDescription: json['problem_description'] as String?,
        totalAmountCents: json['total_amount_cents'] as int,
        paidAmountCents: json['paid_amount_cents'] as int? ?? 0,
        financedOrderAmountCents: json['financed_order_amount_cents'] as int? ?? 0,
        refundedAmountCents: json['refunded_amount_cents'] as int? ?? 0,
        installmentOutstandingCents: json['installment_outstanding_cents'] as int? ?? 0,
        amountDueToTechnicianCents:
            (json['amount_due_to_technician_cents'] as int?) ?? (json['total_amount_cents'] as int),
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
