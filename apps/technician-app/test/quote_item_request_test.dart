import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/models.dart';
import 'package:technician_app/features/orders/quote_item_request.dart';

void main() {
  test('عرض السعر الإضافي يحمل التبرير الإلزامي إلى الـAPI', () {
    final body = buildQuoteItemRequest(
      const QuoteItemInput(
        itemType: 'spare_part',
        nameAr: 'مضخة مياه',
        description: 'المضخة القديمة محترقة ومحتاجة استبدال فوري',
        quantity: 1.0,
        unitPriceCents: 145000,
      ),
    );

    expect(body, {
      'item_type': 'spare_part',
      'name_ar': 'مضخة مياه',
      'description': 'المضخة القديمة محترقة ومحتاجة استبدال فوري',
      'quantity': 1.0,
      'unit_price_cents': 145000,
    });
  });
}
