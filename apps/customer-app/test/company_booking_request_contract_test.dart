import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/orders/orders_repository.dart';
import 'package:flutter_test/flutter_test.dart';

class _CapturingAuthRepository extends AuthRepository {
  Map<String, dynamic>? capturedBody;

  @override
  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) async {
    expect(method, 'POST');
    expect(path, '/orders/preview');
    capturedBody = body;
    return {
      'base_price_cents': 10000,
      'inspection_fee_cents': 0,
      'emergency_surcharge_cents': 0,
      'addons': <Map<String, dynamic>>[],
      'addons_total_cents': 0,
      'warranty_price_cents': 0,
      'subtotal_before_discount_cents': 10000,
      'discount_cents': 0,
      'total_amount_cents': 10000,
      'booking_mode': 'team',
    };
  }
}

void main() {
  test('معاينة السعر تثبّت الشركة المختارة ولا تحولها لفني فردي', () async {
    final auth = _CapturingAuthRepository();
    final repository = OrdersRepository(auth);

    await repository.previewPrice(
      serviceId: 'service-1',
      addressId: 'address-1',
      bookingMode: BookingMode.team,
      requestedTechnicianCompanyId: 'company-1',
    );

    expect(
      auth.capturedBody,
      containsPair('requested_technician_company_id', 'company-1'),
    );
    expect(auth.capturedBody, isNot(contains('requested_technician_id')));
  });
}
