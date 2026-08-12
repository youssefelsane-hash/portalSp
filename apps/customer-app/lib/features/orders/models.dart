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
  final int totalAmountCents;
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
    required this.totalAmountCents,
    required this.paymentStatus,
    required this.placedAt,
    required this.cancelledAt,
    required this.cancellationReasonId,
    required this.cancellationFeeCents,
    required this.createdAt,
    this.address,
    this.warrantyExpiresAt,
    this.originalOrderId,
  });

  bool get isUnderWarranty =>
      warrantyExpiresAt != null && DateTime.parse(warrantyExpiresAt!).isAfter(DateTime.now());

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
        totalAmountCents: json['total_amount_cents'] as int,
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
      );
}

// مطابق لـ apps/api/src/modules/orders/dto/preview-order-response.dto.ts — تفصيل السعر
// الكامل قبل تأكيد الحجز (docs/08 §1/§2). كل حقل هنا بيطابق بالحرف نفس القيم اللي POST /orders
// هيحسبها فعليًا لو اتبعتت نفس المدخلات — مفيش رقم غامض ولا فرق بين المعروض والمحصّل.
class OrderPricePreviewAddon {
  final String id;
  final String nameAr;
  final int priceCents;

  OrderPricePreviewAddon({required this.id, required this.nameAr, required this.priceCents});

  factory OrderPricePreviewAddon.fromJson(Map<String, dynamic> json) => OrderPricePreviewAddon(
        id: json['id'] as String,
        nameAr: json['name_ar'] as String,
        priceCents: json['price_cents'] as int,
      );
}

class OrderPricePreview {
  final int basePriceCents;
  final int inspectionFeeCents;
  final int? minPriceCents;
  final int? maxPriceCents;
  final int emergencySurchargeCents;
  final int? emergencySlaMinutes;
  final List<OrderPricePreviewAddon> addons;
  final int addonsTotalCents;
  final int subtotalBeforeDiscountCents;
  final int discountCents;
  final String? discountSource;
  final int totalAmountCents;
  final double? estimatedDurationDays;

  OrderPricePreview({
    required this.basePriceCents,
    required this.inspectionFeeCents,
    required this.minPriceCents,
    required this.maxPriceCents,
    required this.emergencySurchargeCents,
    required this.emergencySlaMinutes,
    required this.addons,
    required this.addonsTotalCents,
    required this.subtotalBeforeDiscountCents,
    required this.discountCents,
    required this.discountSource,
    required this.totalAmountCents,
    required this.estimatedDurationDays,
  });

  factory OrderPricePreview.fromJson(Map<String, dynamic> json) => OrderPricePreview(
        basePriceCents: json['base_price_cents'] as int,
        inspectionFeeCents: json['inspection_fee_cents'] as int,
        minPriceCents: json['min_price_cents'] as int?,
        maxPriceCents: json['max_price_cents'] as int?,
        emergencySurchargeCents: json['emergency_surcharge_cents'] as int,
        emergencySlaMinutes: json['emergency_sla_minutes'] as int?,
        addons: (json['addons'] as List<dynamic>)
            .map((e) => OrderPricePreviewAddon.fromJson(e as Map<String, dynamic>))
            .toList(),
        addonsTotalCents: json['addons_total_cents'] as int,
        subtotalBeforeDiscountCents: json['subtotal_before_discount_cents'] as int,
        discountCents: json['discount_cents'] as int,
        discountSource: json['discount_source'] as String?,
        totalAmountCents: json['total_amount_cents'] as int,
        estimatedDurationDays: (json['estimated_duration_days'] as num?)?.toDouble(),
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

  factory CancellationReason.fromJson(Map<String, dynamic> json) => CancellationReason(
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

  OrderMedia({required this.id, required this.mediaType, required this.fileUrl, required this.caption});

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
