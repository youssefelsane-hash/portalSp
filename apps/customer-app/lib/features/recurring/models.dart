// الجدولة المستقبلية/المتكررة (docs/08 §11) — مطابق لـ
// apps/api/src/modules/orders/dto/recurring-template-response.dto.ts.
class RecurringTemplate {
  final String id;
  final String serviceId;
  final String addressId;
  final String bookingMode;
  final String? requestedTechnicianId;
  final String frequency;
  final String? problemDescription;
  final String nextRunAt;
  final String? lastGeneratedOrderId;
  final bool isActive;

  RecurringTemplate({
    required this.id,
    required this.serviceId,
    required this.addressId,
    required this.bookingMode,
    required this.requestedTechnicianId,
    required this.frequency,
    required this.problemDescription,
    required this.nextRunAt,
    required this.lastGeneratedOrderId,
    required this.isActive,
  });

  factory RecurringTemplate.fromJson(Map<String, dynamic> json) => RecurringTemplate(
        id: json['id'] as String,
        serviceId: json['service_id'] as String,
        addressId: json['address_id'] as String,
        bookingMode: json['booking_mode'] as String,
        requestedTechnicianId: json['requested_technician_id'] as String?,
        frequency: json['frequency'] as String,
        problemDescription: json['problem_description'] as String?,
        nextRunAt: json['next_run_at'] as String,
        lastGeneratedOrderId: json['last_generated_order_id'] as String?,
        isActive: json['is_active'] as bool,
      );
}

// مطابق لـ RecurringOrderFrequency enum في الباك-إند بالحرف.
const Map<String, String> recurringFrequencyLabelsAr = {
  'weekly': 'أسبوعيًا',
  'monthly': 'شهريًا',
  'yearly': 'سنويًا',
};
