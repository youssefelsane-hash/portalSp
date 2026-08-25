import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/models.dart';

void main() {
  test('parses a resolved technician reschedule request', () {
    final request = OrderRescheduleRequest.fromJson({
      'id': 'request-1',
      'proposed_slot_id': 'slot-2',
      'proposed_at': '2026-09-02T14:00:00.000Z',
      'proposed_end_at': '2026-09-02T16:00:00.000Z',
      'reason': 'تعارض طارئ في الجدول',
      'status': 'approved',
      'created_at': '2026-08-25T10:00:00.000Z',
    });

    expect(request.isPending, isFalse);
    expect(request.status, 'approved');
    expect(request.proposedAt.isUtc, isTrue);
  });
}
