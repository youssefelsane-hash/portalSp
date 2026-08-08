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

  Order({
    required this.id,
    required this.orderNumber,
    required this.serviceId,
    required this.addressId,
    required this.technicianId,
    required this.orderType,
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
  });

  factory Order.fromJson(Map<String, dynamic> json) => Order(
        id: json['id'] as String,
        orderNumber: json['order_number'] as String,
        serviceId: json['service_id'] as String,
        addressId: json['address_id'] as String,
        technicianId: json['technician_id'] as String?,
        orderType: json['order_type'] as String,
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
};

const Set<String> customerCancellableStatuses = {
  'draft',
  'pending_payment',
  'searching_technician',
  'technician_assigned',
  'accepted',
  'technician_on_way',
};
