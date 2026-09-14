// اختبار حي حقيقي لمسار عرض السعر أثناء التنفيذ (order-items.service.ts) ضد apps/api الشغال
// فعلاً — نفس أسلوب order_execution_live_test.dart بالظبط، بس بيغطي الجزء اللي مكانش مغطى هناك:
// الفني بيقترح بنود إضافية، العميل بيوافق، والمبلغ الإضافي بيتحصّل فعلياً وقت الدفع.
// شغّله بـ: flutter test test_live/quote_approval_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';


void main() {
  test('فني بيقترح عرض سعر، العميل بيوافق، والمبلغ الإضافي بيتحصّل فعلياً', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك — الـthrottle بيتعقّب بالرقم (٥ OTP/دقيقة)
    // فملفات متعددة على نفس الرقم كانت بتاكل حصة بعض. (تدقيق §148)
    final customerToken = await registerCustomer(uniquePhone());
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': await pickBookableServiceId(),
        'address_id': await ensureAddressFor(customerToken),
        'problem_description': 'اختبار حي لمسار عرض السعر',
      },
    );
    final orderId = order!['id'] as String;
    final baseTotalCents = order['total_amount_cents'] as int;

    var technicianToken = await devTechnicianToken('+201000000044');
    // الفني اللي العرض راح له فعلاً — المنصّة هي اللي بتوزّع (تفاصيل فوق
    // `claimOrderAsTechnician`، §148).
    technicianToken = await claimOrderAsTechnician(orderId, '+201000000044');
    await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    final started = await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    expect(started!['order_status'], 'in_progress');

    final proposed = await apiRequest(
      'POST',
      '/technician/orders/$orderId/quote-items',
      accessToken: technicianToken,
      body: {
        'items': [
          {
            'item_type': 'spare_part',
            'name_ar': 'اختبار حي — قطعة غيار',
            // `description` إجباري (ADR-0084 §2، ١٠ حروف على الأقل) — العميل لازم يفهم هو
            // بيوافق على إيه بالظبط قبل ما يدفع زيادة. من غيره الرد VAL_001 «البيانات المرسلة
            // غير صحيحة» بلا أي إشارة للحقل الناقص (تدقيق §148).
            'description': 'قطعة غيار بديلة للقطعة التالفة — اختبار حي',
            'quantity': 1,
            'unit_price_cents': 6000,
          },
        ],
      },
    );
    final proposedOrder = proposed!['order'] as Map<String, dynamic>;
    expect(proposedOrder['order_status'], 'awaiting_quote_approval');
    final proposedItems = proposed['items'] as List<dynamic>;
    expect(proposedItems, hasLength(1));
    expect((proposedItems.first as Map<String, dynamic>)['is_customer_approved'], isFalse);

    final quoteItemsAsCustomer = await apiRequestList('/orders/$orderId/quote-items', accessToken: customerToken);
    expect(quoteItemsAsCustomer, hasLength(1));
    expect(quoteItemsAsCustomer.first['name_ar'], 'اختبار حي — قطعة غيار');

    final approveResult = await apiRequest(
      'POST',
      '/orders/$orderId/quote-items/approve',
      accessToken: customerToken,
    );
    final approvedOrder = approveResult!['order'] as Map<String, dynamic>;
    expect(approvedOrder['order_status'], 'in_progress');
    expect(approvedOrder['total_amount_cents'], baseTotalCents + 6000);

    await uploadAfterPhoto(orderId, technicianToken);
    final completed = await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    expect(completed!['order_status'], 'work_completed');

    final payment = await apiRequest(
      'POST',
      '/technician/orders/$orderId/collect-cash',
      accessToken: technicianToken,
    );
    expect(payment!['payment_method'], 'cash');
    expect(payment['payment_status'], 'succeeded');
    expect(payment['amount_cents'], baseTotalCents + 6000);
  });
}
