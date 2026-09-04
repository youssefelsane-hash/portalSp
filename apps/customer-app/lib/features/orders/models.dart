import '../../design/status_chip.dart';

// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts (OrderAddressResponseDto)
// موجود بس في ردود تفاصيل الطلب الفردي (GET /orders/:id)، مش في قوائم الطلبات — لخرائط التتبع.
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

// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts
class Order {
  final String id;
  final String orderNumber;
  final String serviceId;
  final String addressId;
  final String? technicianId;
  final String orderType;
  final String bookingMode;
  final String orderStatus;
  final String? problemDescription;
  final int? estimatedPriceCents;
  final String? initialQuoteSource;
  final String? initialQuoteNote;
  final int totalAmountCents;
  final int warrantyPriceCents;

  /// فرق سعر "الفني المميّز" (docs/08 §60.3) — بيتضاف لما المطابقة التلقائية تعيّن فني
  /// مستواه بيزوّد السعر. 0 لو العميل اختار الفني بنفسه (الفرق داخل السعر أصلاً).
  /// الواجهة بتعرضه كسطر مستقل مكتوب جنبه "فني Premium" عشان العميل يفهم الزيادة جاية منين.
  final int levelPremiumCents;
  final String? optionalWarrantyNameAr;
  final int? optionalWarrantyCoverageMonths;
  final String paymentStatus;
  final String? placedAt;
  final String? cancelledAt;
  final String? cancellationReasonId;
  final int cancellationFeeCents;
  final String createdAt;
  final OrderAddress? address;
  // الضمان/إعادة الزيارة (docs/08 §7) — كانت فجوة موثّقة صراحة: الباك-إند بيرجّع الحقلين دول من
  // زمان (order-response.dto.ts) بس الموديل هنا مكانش بيقراهم خالص، فالعميل ماكانش يعرف إن طلبه
  // تحت ضمان أصلاً ولا يقدر يطلب إعادة زيارة مجانية. null = مفيش ضمان أو الطلب لسه ما اكتملش.
  final String? warrantyExpiresAt;
  // موجود بس لو الطلب ده نفسه "إعادة زيارة" — بيشاور على الطلب الأصلي.
  final String? originalOrderId;
  // محرك الإنتاجية (docs/06 §3.3-§3.6) — snapshot وقت الحجز، null لو الخدمة formula/fixed بلا
  // بيانات قياسية مُستخدمة.
  final int? requiredTechnicians;
  final int? requiredAssistants;
  final int? estimatedDurationDays;
  // سياسة إلغاء الفني (docs/10) — لو الطلب awaiting_technician_reselection، بيشاور على الفني
  // اللي لغى بالذات (اتسيب عمدًا بعد الإلغاء) عشان نستبعده من قايمة اختيار البديل.
  final String? requestedTechnicianId;
  // رقم تليفون الفني (docs/08 §22 بند 1) — موجود بس بعد تأكيد حجيز حقيقي، الباك-إند هو المسؤول
  // الوحيد عن شرط الظهور (order-state-machine.ts's TECHNICIAN_CONTACT_VISIBLE_STATUSES).
  final String? technicianName;
  final String? technicianPhone;
  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — تأكيد العميل وحده، مايسوّيش الطلب لوحده.
  final String? customerCashConfirmedAt;
  final String? technicianCashNotReceivedAt;
  // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — null = ASAP (اختيار العميل الصريح وقت الحجز، مش سهو).
  final String? scheduledAt;
  // أول حجز في الخطة والطلبات المولدة لاحقًا يحملان نفس هوية التكرار، فيظهران في "طلباتي"
  // وفي قسم الحجوزات المتكررة من غير فقدان أو ازدواج دلالي.
  final String? recurringTemplateId;
  final String? recurringOccurrenceAt;

  Order({
    required this.id,
    required this.orderNumber,
    required this.serviceId,
    required this.addressId,
    required this.technicianId,
    required this.orderType,
    required this.bookingMode,
    required this.orderStatus,
    required this.problemDescription,
    required this.estimatedPriceCents,
    this.initialQuoteSource,
    this.initialQuoteNote,
    required this.totalAmountCents,
    this.warrantyPriceCents = 0,
    this.optionalWarrantyNameAr,
    this.optionalWarrantyCoverageMonths,
    required this.paymentStatus,
    required this.placedAt,
    required this.cancelledAt,
    required this.cancellationReasonId,
    required this.cancellationFeeCents,
    required this.createdAt,
    this.address,
    this.warrantyExpiresAt,
    this.originalOrderId,
    this.requiredTechnicians,
    this.requiredAssistants,
    this.estimatedDurationDays,
    this.requestedTechnicianId,
    this.technicianName,
    this.technicianPhone,
    this.customerCashConfirmedAt,
    this.technicianCashNotReceivedAt,
    this.scheduledAt,
    this.recurringTemplateId,
    this.recurringOccurrenceAt,
    this.levelPremiumCents = 0,
  });

  bool get isUnderWarranty =>
      warrantyExpiresAt != null &&
      DateTime.parse(warrantyExpiresAt!).isAfter(DateTime.now());

  factory Order.fromJson(Map<String, dynamic> json) => Order(
    id: json['id'] as String,
    orderNumber: json['order_number'] as String,
    serviceId: json['service_id'] as String,
    addressId: json['address_id'] as String,
    technicianId: json['technician_id'] as String?,
    orderType: json['order_type'] as String,
    bookingMode: json['booking_mode'] as String,
    orderStatus: json['order_status'] as String,
    problemDescription: json['problem_description'] as String?,
    estimatedPriceCents: json['estimated_price_cents'] as int?,
    initialQuoteSource: json['initial_quote_source'] as String?,
    initialQuoteNote: json['initial_quote_note'] as String?,
    totalAmountCents: json['total_amount_cents'] as int,
    warrantyPriceCents: json['warranty_price_cents'] as int? ?? 0,
    levelPremiumCents: json['level_premium_cents'] as int? ?? 0,
    optionalWarrantyNameAr:
        (json['optional_warranty'] as Map<String, dynamic>?)?['name_ar']
            as String?,
    optionalWarrantyCoverageMonths:
        (json['optional_warranty'] as Map<String, dynamic>?)?['coverage_months']
            as int?,
    paymentStatus: json['payment_status'] as String,
    placedAt: json['placed_at'] as String?,
    cancelledAt: json['cancelled_at'] as String?,
    cancellationReasonId: json['cancellation_reason_id'] as String?,
    cancellationFeeCents: json['cancellation_fee_cents'] as int? ?? 0,
    createdAt: json['created_at'] as String,
    address: json['address'] != null
        ? OrderAddress.fromJson(json['address'] as Map<String, dynamic>)
        : null,
    warrantyExpiresAt: json['warranty_expires_at'] as String?,
    originalOrderId: json['original_order_id'] as String?,
    requiredTechnicians: json['required_technicians'] as int?,
    requiredAssistants: json['required_assistants'] as int?,
    estimatedDurationDays: json['estimated_duration_days'] as int?,
    requestedTechnicianId: json['requested_technician_id'] as String?,
    technicianName: json['technician_name'] as String?,
    technicianPhone: json['technician_phone'] as String?,
    customerCashConfirmedAt: json['customer_cash_confirmed_at'] as String?,
    technicianCashNotReceivedAt:
        json['technician_cash_not_received_at'] as String?,
    scheduledAt: json['scheduled_at'] as String?,
    recurringTemplateId: json['recurring_template_id'] as String?,
    recurringOccurrenceAt: json['recurring_occurrence_at'] as String?,
  );
}

// مطابق لـ apps/api/src/modules/orders/dto/preview-order-response.dto.ts — تفصيل السعر
// الكامل قبل تأكيد الحجز (docs/08 §1/§2). كل حقل هنا بيطابق بالحرف نفس القيم اللي POST /orders
// هيحسبها فعليًا لو اتبعتت نفس المدخلات — مفيش رقم غامض ولا فرق بين المعروض والمحصّل.
class OrderPricePreviewAddon {
  final String id;
  final String nameAr;
  final int priceCents;

  OrderPricePreviewAddon({
    required this.id,
    required this.nameAr,
    required this.priceCents,
  });

  factory OrderPricePreviewAddon.fromJson(Map<String, dynamic> json) =>
      OrderPricePreviewAddon(
        id: json['id'] as String,
        nameAr: json['name_ar'] as String,
        priceCents: json['price_cents'] as int,
      );
}

class OrderPricePreview {
  final int basePriceCents;
  final int inspectionFeeCents;

  /// حدود **قصّ** المحرك — مش نطاق بيتعرض للعميل (بند 29). سايبينها في الموديل عشان الحسابات
  /// والتشخيص، لكن ممنوع ترسمها كـ«نطاق تقديري».
  final int? minPriceCents;
  final int? maxPriceCents;

  /// **نطاق العرض** للعميل — ده اللي بيتعرض فعلاً (ADR-0063، بند 10/29). منفصل تمامًا عن
  /// حدود القصّ فوق، وبيتحسب في الباك-إند حوالين السعر المحسوب بعد ما القصّ اتطبّق.
  final int? displayPriceMinCents;
  final int? displayPriceMaxCents;

  /// وضع يقين السعر — النطاق بيتعرض لـ`estimated_range` بس.
  final String priceCertaintyMode;
  final int emergencySurchargeCents;
  final int? emergencySlaMinutes;
  final List<OrderPricePreviewAddon> addons;
  final int addonsTotalCents;
  final int warrantyPriceCents;
  final int subtotalBeforeDiscountCents;
  final int discountCents;
  final String? discountSource;
  final int totalAmountCents;
  final double? estimatedDurationDays;
  // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — كانت فجوة موثّقة صراحة: الباك-إند بيرجّعها
  // من زمان (PreviewOrderResponseDto) بس مش مقروءة هنا خالص، فالعميل ما كانش يعرف إن الخدمة
  // محتاجة إيداع غير بعد ما يحاول يدفع كاش ويترفض. null يعني مفيش إيداع مطلوب.
  final int? depositAmountCents;
  final int dueNowCents;
  final int? remainingAmountCents;

  OrderPricePreview({
    required this.basePriceCents,
    required this.inspectionFeeCents,
    required this.minPriceCents,
    required this.maxPriceCents,
    required this.displayPriceMinCents,
    required this.displayPriceMaxCents,
    required this.priceCertaintyMode,
    required this.emergencySurchargeCents,
    required this.emergencySlaMinutes,
    required this.addons,
    required this.addonsTotalCents,
    required this.warrantyPriceCents,
    required this.subtotalBeforeDiscountCents,
    required this.discountCents,
    required this.discountSource,
    required this.totalAmountCents,
    required this.estimatedDurationDays,
    required this.depositAmountCents,
    required this.dueNowCents,
    required this.remainingAmountCents,
  });

  factory OrderPricePreview.fromJson(
    Map<String, dynamic> json,
  ) => OrderPricePreview(
    basePriceCents: json['base_price_cents'] as int,
    inspectionFeeCents: json['inspection_fee_cents'] as int,
    minPriceCents: json['min_price_cents'] as int?,
    maxPriceCents: json['max_price_cents'] as int?,
    displayPriceMinCents: json['display_price_min_cents'] as int?,
    displayPriceMaxCents: json['display_price_max_cents'] as int?,
    priceCertaintyMode:
        json['price_certainty_mode'] as String? ?? 'confirmed_price',
    emergencySurchargeCents: json['emergency_surcharge_cents'] as int,
    emergencySlaMinutes: json['emergency_sla_minutes'] as int?,
    addons: (json['addons'] as List<dynamic>)
        .map((e) => OrderPricePreviewAddon.fromJson(e as Map<String, dynamic>))
        .toList(),
    addonsTotalCents: json['addons_total_cents'] as int,
    warrantyPriceCents: json['warranty_price_cents'] as int? ?? 0,
    subtotalBeforeDiscountCents: json['subtotal_before_discount_cents'] as int,
    discountCents: json['discount_cents'] as int,
    discountSource: json['discount_source'] as String?,
    totalAmountCents: json['total_amount_cents'] as int,
    estimatedDurationDays: (json['estimated_duration_days'] as num?)
        ?.toDouble(),
    depositAmountCents: json['deposit_amount_cents'] as int?,
    dueNowCents:
        json['due_now_cents'] as int? ?? json['total_amount_cents'] as int,
    remainingAmountCents: json['remaining_amount_cents'] as int?,
  );
}

// مطابق لـ apps/api/src/modules/orders/dto/cancellation-reason-response.dto.ts
class CancellationReason {
  final String id;
  final String reasonAr;
  final bool chargesFee;
  final double feePercentage;

  CancellationReason({
    required this.id,
    required this.reasonAr,
    required this.chargesFee,
    required this.feePercentage,
  });

  factory CancellationReason.fromJson(Map<String, dynamic> json) =>
      CancellationReason(
        id: json['id'] as String,
        reasonAr: json['reason_ar'] as String,
        chargesFee: json['charges_fee'] as bool,
        feePercentage: (json['fee_percentage'] as num).toDouble(),
      );
}

// نفس تسميات order_status في docs/02-data-dictionary.md §6.2 — نص عربي للعرض بس، القيمة
// الحقيقية المُخزّنة/المُرسلة للـ API هي الإنجليزية زي ما هي.
const Map<String, String> orderStatusLabelsAr = {
  'draft': 'مسودة',
  'pending_payment': 'في انتظار الدفع',
  'searching_technician': 'بيدوّر على فني',
  'technician_assigned': 'اتعيّن فني',
  'accepted': 'الفني قبل الطلب',
  'technician_on_way': 'الفني في الطريق',
  'technician_arrived': 'الفني وصل',
  'in_progress': 'الشغل شغّال',
  'awaiting_quote_approval': 'في انتظار موافقتك على السعر',
  'awaiting_admin_quote': 'في انتظار تسعير الإدارة',
  'awaiting_initial_quote_approval': 'السعر جاهز وفي انتظار موافقتك',
  'work_completed': 'الشغل خلص',
  'awaiting_payment': 'في انتظار الدفع',
  'completed': 'اتقفل',
  'cancelled_by_customer': 'اتلغى منك',
  'cancelled_by_technician': 'اتلغى من الفني',
  'cancelled_by_system': 'اتلغى تلقائياً',
  'expired': 'انتهت صلاحيته',
  'disputed': 'فيه خلاف',
  'refunded': 'اترد',
  // سياسة إلغاء الفني (docs/10) — الفني اعتذر عن طلب كنت اختاره بنفسك، محتاج تختار بديل.
  'awaiting_technician_reselection': 'محتاج تختار فني بديل',
};

/// نغمة الحالة للعرض (docs/08 §125) — تطبيق الفني بيعرض حالاته كـ`StatusChip` ملوّن بينما
/// تطبيق العميل كان بيعرض نفس النوع من المعلومة كنص رمادي. الخريطة دي هي القرار الوحيد
/// «أنهي حالة أنهي نغمة» عند العميل، جنب التسميات بالظبط عشان أي حالة جديدة تتضاف مرة واحدة.
StatusTone orderStatusTone(String status) {
  switch (status) {
    case 'completed':
    case 'work_completed':
      return StatusTone.success;
    case 'cancelled_by_customer':
    case 'cancelled_by_technician':
    case 'cancelled_by_system':
    case 'expired':
    case 'disputed':
      return StatusTone.danger;
    // كل حالة بتستنى قرار أو دفع **من العميل** — دي اللي المفروض تلفت نظره.
    case 'pending_payment':
    case 'awaiting_payment':
    case 'awaiting_quote_approval':
    case 'awaiting_initial_quote_approval':
    case 'awaiting_technician_reselection':
      return StatusTone.warning;
    case 'draft':
    case 'refunded':
      return StatusTone.neutral;
    // الباقي شغل ماشي: بيدوّر على فني، اتعيّن، في الطريق، وصل، شغّال، الإدارة بتسعّر.
    default:
      return StatusTone.info;
  }
}

// مطابق لـ CUSTOMER_CANCELLABLE_STATUSES في order-state-machine.ts بالظبط — awaiting_quote_approval
// اتضافت مع مسار عرض السعر (order-items.service.ts): العميل يقدر يلغي الطلب كله بدل ما يوافق/يرفض
// البنود المقترحة، لو مش عايز يكمل خالص بسبب السعر الإضافي.
const Set<String> customerCancellableStatuses = {
  'draft',
  'pending_payment',
  'searching_technician',
  'technician_assigned',
  'accepted',
  'technician_on_way',
  'awaiting_quote_approval',
  'awaiting_admin_quote',
  'awaiting_initial_quote_approval',
  'awaiting_technician_reselection',
};

// مطابق لـ apps/api/src/modules/orders/dto/order-item-response.dto.ts — بنود عرض السعر
// أثناء التنفيذ (قطع غيار/أجرة إضافية بيقترحها الفني، أو إضافات كتالوج اختارها العميل وقت الحجز).
class OrderItem {
  final String id;
  final String itemType;
  final String nameAr;
  final double quantity;
  final String? unitName;
  final int unitPriceCents;
  final int totalPriceCents;
  final bool isCustomerApproved;

  OrderItem({
    required this.id,
    required this.itemType,
    required this.nameAr,
    required this.quantity,
    required this.unitName,
    required this.unitPriceCents,
    required this.totalPriceCents,
    required this.isCustomerApproved,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) => OrderItem(
    id: json['id'] as String,
    itemType: json['item_type'] as String,
    nameAr: json['name_ar'] as String,
    quantity: (json['quantity'] as num).toDouble(),
    unitName: json['unit_name'] as String?,
    unitPriceCents: json['unit_price_cents'] as int,
    totalPriceCents: json['total_price_cents'] as int,
    isCustomerApproved: json['is_customer_approved'] as bool,
  );
}

const Map<String, String> orderItemTypeLabelsAr = {
  'service': 'خدمة',
  'addon': 'إضافة',
  'spare_part': 'قطعة غيار',
  'extra_labor': 'أجرة إضافية',
};

// تقييم متقدم + صور بعد الخدمة (docs/08 §9) — كانت فجوة موثّقة صراحة: مفيش endpoint للعميل
// يشوف بيه صور "قبل/بعد" الطلب أصلاً. مطابق لـ apps/api/src/modules/orders/dto/order-media-response.dto.ts.
class OrderMedia {
  final String id;
  final String mediaType;
  final String fileUrl;
  final String? caption;

  OrderMedia({
    required this.id,
    required this.mediaType,
    required this.fileUrl,
    required this.caption,
  });

  factory OrderMedia.fromJson(Map<String, dynamic> json) => OrderMedia(
    id: json['id'] as String,
    mediaType: json['media_type'] as String,
    fileUrl: json['file_url'] as String,
    caption: json['caption'] as String?,
  );
}

// توزيع أدوار الفريق (docs/08 §5) — كانت فجوة موثّقة صراحة: GET /orders/:id/team-members موجود
// من زمان (عميل يشوف مين هيشتغل معاه فعليًا في طلب "اعتماد")، بس مفيش أي كود Dart كان بينادي
// عليه خالص — endpoint يتيم بالكامل. مطابق لـ apps/api/src/modules/orders/dto/team-member-response.dto.ts.
class TeamMember {
  final String id;
  final String technicianId;
  final String fullName;
  final String? avatarUrl;
  final String roleLabel;

  TeamMember({
    required this.id,
    required this.technicianId,
    required this.fullName,
    required this.avatarUrl,
    required this.roleLabel,
  });

  factory TeamMember.fromJson(Map<String, dynamic> json) => TeamMember(
    id: json['id'] as String,
    technicianId: json['technician_id'] as String,
    fullName: json['full_name'] as String,
    avatarUrl: json['avatar_url'] as String?,
    roleLabel: json['role_label'] as String,
  );
}

class OrderRescheduleRequest {
  final String id;
  final String proposedSlotId;
  final DateTime proposedAt;
  final DateTime proposedEndAt;
  final String reason;
  final String status;
  final DateTime createdAt;

  OrderRescheduleRequest({
    required this.id,
    required this.proposedSlotId,
    required this.proposedAt,
    required this.proposedEndAt,
    required this.reason,
    required this.status,
    required this.createdAt,
  });

  bool get isPending => status == 'pending';

  factory OrderRescheduleRequest.fromJson(Map<String, dynamic> json) =>
      OrderRescheduleRequest(
        id: json['id'] as String,
        proposedSlotId: json['proposed_slot_id'] as String,
        proposedAt: DateTime.parse(json['proposed_at'] as String),
        proposedEndAt: DateTime.parse(json['proposed_end_at'] as String),
        reason: json['reason'] as String,
        status: json['status'] as String,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}

class RescheduleDateOption {
  final String date;
  final bool available;

  const RescheduleDateOption({required this.date, required this.available});

  factory RescheduleDateOption.fromJson(Map<String, dynamic> json) =>
      RescheduleDateOption(
        date: json['date'] as String,
        available: json['available'] as bool? ?? false,
      );
}
