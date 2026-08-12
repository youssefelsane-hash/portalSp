// الجدولة الحقيقية للفني (docs/08 §2-§3، ADR-0002) — مطابق لـ
// apps/api/src/modules/technicians/dto/schedule-slot-response.dto.ts's ScheduleSlotResponseDto
// (نسخة الفني الكاملة — فيها order_id/notes_ar، عكس نسخة العميل العامة).
class ScheduleSlot {
  final String id;
  final String slotDate;
  final String startTime;
  final String endTime;
  final String status;
  final String? orderId;
  final String? notesAr;

  ScheduleSlot({
    required this.id,
    required this.slotDate,
    required this.startTime,
    required this.endTime,
    required this.status,
    required this.orderId,
    required this.notesAr,
  });

  bool get isBooked => status == 'booked';

  factory ScheduleSlot.fromJson(Map<String, dynamic> json) => ScheduleSlot(
        id: json['id'] as String,
        slotDate: json['slot_date'] as String,
        startTime: json['start_time'] as String,
        endTime: json['end_time'] as String,
        status: json['status'] as String,
        orderId: json['order_id'] as String?,
        notesAr: json['notes_ar'] as String?,
      );
}
