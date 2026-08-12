// سياسة إلغاء الفني (docs/10) — مطابق لـ apps/api/src/modules/orders/dto/cancellation-reason-response.dto.ts.
// GET /cancellation-reasons?applies_to=technician بيرجّع القايمة دي.
class CancellationReason {
  final String id;
  final String reasonAr;
  final bool chargesFee;
  final double feePercentage;
  final bool requiresFreeText;

  CancellationReason({
    required this.id,
    required this.reasonAr,
    required this.chargesFee,
    required this.feePercentage,
    required this.requiresFreeText,
  });

  factory CancellationReason.fromJson(Map<String, dynamic> json) => CancellationReason(
        id: json['id'] as String,
        reasonAr: json['reason_ar'] as String,
        chargesFee: json['charges_fee'] as bool,
        feePercentage: double.parse(json['fee_percentage'].toString()),
        requiresFreeText: json['requires_free_text'] as bool,
      );
}

// مطابق لـ apps/api/src/modules/orders/dto/technician-cancellation-policy-response.dto.ts —
// استشاري بس (الفرض الحقيقي جوّه الباك-إند)، بيحدد هل زرار "إلغاء الطلب" يظهر أصلاً.
class CancellationPolicy {
  final bool canCancel;
  final String? reasonIfNot;
  final DateTime? windowExpiresAt;

  CancellationPolicy({required this.canCancel, required this.reasonIfNot, required this.windowExpiresAt});

  factory CancellationPolicy.fromJson(Map<String, dynamic> json) => CancellationPolicy(
        canCancel: json['can_cancel'] as bool,
        reasonIfNot: json['reason_if_not'] as String?,
        windowExpiresAt: json['window_expires_at'] != null ? DateTime.parse(json['window_expires_at'] as String) : null,
      );
}

// مطابق لـ apps/api/src/modules/matching/matching.service.ts (AvailableOrderRow)
class AvailableOrder {
  final String assignmentId;
  final String orderId;
  final String orderNumber;
  final String serviceNameAr;
  final String? problemDescription;
  final String streetName;
  final String? landmark;
  final double distanceKm;
  final DateTime expiresAt;

  AvailableOrder({
    required this.assignmentId,
    required this.orderId,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.problemDescription,
    required this.streetName,
    required this.landmark,
    required this.distanceKm,
    required this.expiresAt,
  });

  factory AvailableOrder.fromJson(Map<String, dynamic> json) => AvailableOrder(
        assignmentId: json['assignment_id'] as String,
        orderId: json['order_id'] as String,
        orderNumber: json['order_number'] as String,
        serviceNameAr: json['service_name_ar'] as String,
        problemDescription: json['problem_description'] as String?,
        streetName: json['street_name'] as String,
        landmark: json['landmark'] as String?,
        distanceKm: double.parse(json['distance_km'].toString()),
        expiresAt: DateTime.parse(json['expires_at'] as String),
      );
}
