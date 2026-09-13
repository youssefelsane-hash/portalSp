/// عقد البند الإضافي الذي يرسله تطبيق الفني إلى `quote-items`.
///
/// إبقاؤه هنا بدل خريطة موزعة داخل الشاشة يجعل الحقول المالية المطلوبة مرئية وقابلة للاختبار؛
/// خصوصًا `description` الذي يحتاجه العميل والإدارة لتبرير أي زيادة في السعر.
Map<String, dynamic> buildQuoteItemRequest({
  required String itemType,
  required String nameAr,
  required String description,
  required double quantity,
  required int unitPriceCents,
}) {
  return {
    'item_type': itemType,
    'name_ar': nameAr,
    'description': description,
    'quantity': quantity,
    'unit_price_cents': unitPriceCents,
  };
}
