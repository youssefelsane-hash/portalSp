import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/ratings/ratings_repository.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeAuthRepository extends AuthRepository {
  String? requestedPath;

  @override
  Future<List<Map<String, dynamic>>> authedRequestList(String path) async {
    requestedPath = path;
    return [
      {
        'order_id': 'order-id',
        'order_number': 'ORD-42',
        'service_name_ar': 'سباكة',
        'technician_name': 'أحمد',
        'completed_at': '2026-09-12T10:00:00.000Z',
      },
    ];
  }
}

void main() {
  test(
    'pending ratings use the global pending endpoint and parse the order context',
    () async {
      final auth = _FakeAuthRepository();
      final repository = RatingsRepository(auth);

      final result = await repository.pending();

      expect(auth.requestedPath, '/ratings/pending');
      expect(result, hasLength(1));
      expect(result.single.orderId, 'order-id');
      expect(result.single.orderNumber, 'ORD-42');
      expect(result.single.serviceNameAr, 'سباكة');
      expect(result.single.technicianName, 'أحمد');
      expect(result.single.completedAt.toUtc(), DateTime.utc(2026, 9, 12, 10));
    },
  );
}
