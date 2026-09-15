import 'models.dart';

/// **الشكل اللي بيتبعت على السلك لبند عرض السعر الإضافي** — تعريف واحد ووحيد.
///
/// أصله من `main` (إصلاح المالك لبلاغ «البيانات المرسلة غير صحيحة»)، واتحافظ عليه عن قصد بدل
/// ما الشكل يتكتب literal جوّه الـrepository: كده فيه **مكان واحد** بيعرف المفاتيح، وعليه
/// اختبار Dart حقيقي (`test/quote_item_request_test.dart`)، و`scripts/mobile-api-contract-audit.js`
/// بيقراه ويقارنه بالـDTO.
///
/// المدخل بقى `QuoteItemInput` مش خمس معاملات منفصلة: النوع ده كل حقوله `required`، فالمترجم
/// هو اللي بيمنع أي حقل إجباري ناقص — وده اللي البَقّة الأصلية عدّت منه (`Map<String, dynamic>`
/// بيقبل أي حاجة).
Map<String, dynamic> buildQuoteItemRequest(QuoteItemInput item) {
  return {
    'item_type': item.itemType,
    'name_ar': item.nameAr,
    'description': item.description,
    'quantity': item.quantity,
    'unit_price_cents': item.unitPriceCents,
  };
}
