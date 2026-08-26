import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/warranty/warranties_screen.dart';

void main() {
  test('warranty claim description explains why short text cannot be sent', () {
    expect(validateWarrantyClaimDescription(''), 'اكتب وصف العيب الأول');
    expect(
      validateWarrantyClaimDescription('كسر'),
      'كمّل الوصف شوية — لازم 10 حروف على الأقل',
    );
    expect(validateWarrantyClaimDescription('كسر واضح في الحائط'), isNull);
  });
}
