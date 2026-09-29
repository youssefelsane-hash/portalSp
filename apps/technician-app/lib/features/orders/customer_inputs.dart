/// اختيارات العميل على الفورم الديناميكي زي ما مقدم الخدمة محتاج يقراها (docs/08 §185).
///
/// **البَقّة اللي الملف ده بيقفلها** (بلاغ مالك بلقطات): خدمة المكوجي فيها ~٢٠ حقل، والتطبيق
/// كان بيعمل `join(' · ')` لكل الإجابات في فقرة واحدة — «تيشيرتات: 0 · نوع الخدمة للتيشيرتات:
/// نفس الخدمة الأساسية سيتم استخدام نوع الخدمة…» — فمقدم الخدمة كان بيقرا ٢٠ سطر عشان يلاقي
/// الاتنين اللي العميل غيّرهم فعلًا.
///
/// القاعدة: القيم بتفضل **قايمة منظمة** لحد الرسم، والفلترة بالـmetadata اللي السيرفر حسبها
/// وقت الحجز (`is_default` بنفس قاعدة محرك التسعير) — **مش** بإخفاء الصفر بشكل أعمى: صفر في
/// حقل إجباري أو حقل مالوش افتراضي ممكن يبقى معلومة حقيقية.
library;

/// الـ`unit_ar` أطول من كده مش وحدة («قميص»، «م²») — ده شرح الأدمن للعميل («حدد عدد البلوزات
/// في الطلب»). نفس الحد اللي تطبيق العميل بيفرّق بيه بين الوحدة والشرح.
const kMaxInlineUnitLength = 24;

/// من غير metadata (طلب أقدم من docs/08 §185) مانقدرش نعرف مين افتراضي، فبنعرض الكل — بس بعد
/// العدد ده بنطوي الباقي ورا «عرض الكل» عشان الشاشة ماتتحوّلش لفقرة طويلة تاني.
const kCollapsedCustomerInputsCount = 6;

/// مصطلح إنجليزي جوّه تسمية عربية («عدد الجاكيتات (Jackets / Blazers)») بيتعزل اتجاهيًا في
/// `LRI…PDI` فمايتقسمش ويعكس القوس لما السطر يلف. نفس `bidiSafeText` في تطبيق العميل.
String bidiSafeText(String text) => text.replaceAllMapped(
  RegExp(
    r"\([^()\u0600-\u06FF]*[A-Za-z][^()\u0600-\u06FF]*\)"
    r"|[A-Za-z][A-Za-z0-9 /&.,+'\-]*[A-Za-z0-9.]"
    r"|[A-Za-z]",
  ),
  (m) => '\u2066${m[0]}\u2069',
);

class CustomerInputItem {
  final String key;
  final String label;
  final String value;
  final String? unit;
  final String? fieldType;
  final bool? isRequired;
  final bool? isDefault;
  final bool? integerQuantity;

  const CustomerInputItem({
    required this.key,
    required this.label,
    required this.value,
    this.unit,
    this.fieldType,
    this.isRequired,
    this.isDefault,
    this.integerQuantity,
  });

  /// بيقبل أي شكل تاريخي للـsnapshot: الحقول الجديدة كلها اختيارية، والقيمة ممكن تيجي رقم.
  static CustomerInputItem? tryParse(Object? raw) {
    if (raw is! Map) return null;
    String? text(Object? value) {
      if (value == null) return null;
      final result = value.toString().trim();
      return result.isEmpty ? null : result;
    }

    final label = text(raw['label']);
    final value = text(raw['value']);
    if (label == null || value == null) return null;
    return CustomerInputItem(
      key: text(raw['key']) ?? label,
      label: label,
      value: value,
      unit: text(raw['unit']),
      fieldType: text(raw['field_type']),
      isRequired: raw['is_required'] is bool ? raw['is_required'] as bool : null,
      isDefault: raw['is_default'] is bool ? raw['is_default'] as bool : null,
      integerQuantity: raw['integer_quantity'] is bool
          ? raw['integer_quantity'] as bool
          : null,
    );
  }

  bool get hasMetadata => isDefault != null || fieldType != null;

  /// حقل اختياري العميل سابه على قيمته الافتراضية — مابيضيفش معلومة لمقدم الخدمة.
  bool get isNoise => isDefault == true && isRequired != true;

  /// الوحدة كلاحقة للقيمة بس لو هي فعلًا وحدة قصيرة، مش شرح الأدمن.
  String? get displayUnit {
    final value = unit;
    if (value == null || value.length > kMaxInlineUnitLength) return null;
    return value;
  }

  /// عدّاد قطع (slider بحدود صحيحة) بيتقرّب — نسخ التطبيق القديمة كانت بتبعت `1.9639…`
  /// والعميل شايف «2». من غير العلامة دي القيمة بتتعرض زي ما هي بالظبط.
  String get displayValue {
    if (integerQuantity == true) {
      final numeric = num.tryParse(value);
      if (numeric != null) return numeric.round().toString();
    }
    return value;
  }

  String get displayValueWithUnit {
    final suffix = displayUnit;
    return suffix == null ? displayValue : '$displayValue $suffix';
  }
}

List<CustomerInputItem> parseCustomerInputs(Object? raw) {
  if (raw is! List) return const [];
  return raw
      .map(CustomerInputItem.tryParse)
      .whereType<CustomerInputItem>()
      .toList(growable: false);
}

/// اللي هيتعرض فعلًا — بترتيب الحجز (`display_order`) زي ما هو.
class CustomerInputsSummary {
  /// القيم اللي العميل حددها فعلًا (أو كل القيم لطلب قديم بلا metadata).
  final List<CustomerInputItem> meaningful;

  /// حقول اختيارية فضلت على افتراضيها — متاحة ورا «عرض الكل»، مش ممسوحة.
  final List<CustomerInputItem> defaults;

  const CustomerInputsSummary({required this.meaningful, required this.defaults});

  factory CustomerInputsSummary.from(List<CustomerInputItem> items) =>
      CustomerInputsSummary(
        meaningful: items.where((item) => !item.isNoise).toList(growable: false),
        defaults: items.where((item) => item.isNoise).toList(growable: false),
      );

  bool get isEmpty => meaningful.isEmpty && defaults.isEmpty;

  int get total => meaningful.length + defaults.length;
}
