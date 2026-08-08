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
