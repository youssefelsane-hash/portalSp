import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'models.dart';

// فورم الحقول الديناميكية — **رسّام عام واحد لكل الخدمات** (docs/08 §185).
//
// المنصة بتخدم خدمات مختلفة جدًا (مكوجي، تنظيف، سجاد، دهانات، نجارة، بالقطعة، سواق…)، والأدمن
// هو اللي بيعرّف أسئلة كل خدمة. فالقاعدة إن **مفيش أي سطر هنا يعرف اسم خدمة أو اسم حقل** —
// شكل كل سؤال بيتحدد من نوعه وبياناته بس (عدد الاختيارات، حدود العدّاد، طول الشرح).
//
// اللي اتغيّر وليه (بلاغ مالك بلقطات من موبايل حقيقي):
// - التسمية كانت `labelText` جوّه الـinput ⇒ بتتقص («إجمالي مساحة السجاد المطلوب تنظيفه (...»).
//   دلوقتي كل سؤال: عنوان ← شرح ← الـcontrol ← رسالة الخطأ، والنصوص كلها بتلف.
// - `unit_ar` كان بيتعرض بين قوسين جنب الاسم أو جوّه الـhelper. الأدمن بيستخدمه للاتنين: وحدة
//   قصيرة («قميص») أو شرح كامل («حدد عدد البلوزات في الطلب»). القصير وحدة جنب القيمة، والطويل
//   شرح تحت العنوان — بلا أقواس.
// - dropdown لـ٣ اختيارات كان بيخبّيهم. ≤٤ بيتعرضوا مباشرة، والأكتر في bottom sheet.
// - الـslider كان بيخزّن double خام — العميل شايف «2» والطلب رايح بـ`1.9639846991701237`.
//   العدّاد الصحيح بقى int من المصدر، والمدى الصغير بقى [-] 3 [+].
//
// **القيم اللي بتتبعت للسيرفر مااتغيّرتش**: نفس `option.value` بالظبط (`wash_iron` فضلت
// `wash_iron`)، ونفس الأنواع. التغيير عرض وتطبيع إدخال بس.

typedef PricingFieldImageUploader =
    Future<String> Function(PricingField field, XFile image);

/// الوحدة لو أطول من كده مش وحدة — ده شرح. نفس الحد في تطبيق الفني (`kMaxInlineUnitLength`).
const kMaxInlineUnitLength = 24;

/// أقصى عدد اختيارات يتعرض مباشرة بدل منتقي منفصل.
const kInlineChoicesMaxCount = 4;

/// عدّاد صحيح مداه أصغر من أو يساوي ده بيتعرض [-] 3 [+] بدل slider (أدق وأسهل بصباع واحد).
const kStepperMaxRange = 30;

String? _cleanUnit(PricingField field) {
  final unit = field.unitAr?.trim();
  return unit == null || unit.isEmpty ? null : unit;
}

/// **مصطلح إنجليزي جوّه جملة عربية** («تنظيف الفرن بعمق (Deep cleaning)») لما السطر يلف، الـbidi
/// بيقسم المقطع اللاتيني ويعكس القوس: السطر التاني بيطلع «(cleaning». بنعزل كل مقطع لاتيني
/// (ومعاه قوسه لو القوس كله لاتيني) في `LRI…PDI` فيتعامل كوحدة LTR واحدة — نفس أسلوب
/// `isolateBidi` في `core/arabic_time.dart`. النص نفسه مابيتغيّرش غير بمحرفين غير مرئيين.
String bidiSafeText(String text) => text.replaceAllMapped(
  RegExp(
    r"\([^()؀-ۿ]*[A-Za-z][^()؀-ۿ]*\)"
    r"|[A-Za-z][A-Za-z0-9 /&.,+'\-]*[A-Za-z0-9.]"
    r"|[A-Za-z]",
  ),
  (m) => '\u2066${m[0]}\u2069',
);

/// الوحدة القصيرة («قميص»، «م²») اللي بتتكتب جنب القيمة — `null` لو الـ`unit_ar` شرح.
String? pricingFieldInlineUnit(PricingField field) {
  final unit = _cleanUnit(field);
  return unit != null && unit.length <= kMaxInlineUnitLength ? unit : null;
}

/// شرح الأدمن للسؤال — بيتعرض كامل تحت العنوان، `null` لو مفيش (مفيش مساحة فاضية).
String? pricingFieldHelperText(PricingField field) {
  final unit = _cleanUnit(field);
  if (unit == null || unit.length <= kMaxInlineUnitLength) return null;
  // الأدمن ساعات بيكتب الشرح بين قوسين أصلًا — مانعرضهوش «((…))».
  final unwrapped = unit.startsWith('(') && unit.endsWith(')')
      ? unit.substring(1, unit.length - 1).trim()
      : unit;
  return unwrapped.isEmpty ? null : unwrapped;
}

/// slider حدوده أعداد صحيحة = عدّاد (قطع/غرف/أجهزة). حدود عشرية = قيمة متصلة فعلًا
/// وبتفضل بسلوكها القديم. نفس القاعدة في السيرفر (`isIntegerQuantityField`).
bool isIntegerSliderField(PricingField field) {
  if (field.fieldType != 'slider') return false;
  final min = field.minValue ?? 0;
  final max = field.maxValue ?? 100;
  return min == min.roundToDouble() && max == max.roundToDouble();
}

bool usesQuantityStepper(PricingField field) {
  if (!isIntegerSliderField(field)) return false;
  final range = _sliderMax(field) - _sliderMin(field);
  return range > 0 && range <= kStepperMaxRange;
}

double _sliderMin(PricingField field) => (field.minValue ?? 0).toDouble();

double _sliderMax(PricingField field) {
  final min = _sliderMin(field);
  final max = (field.maxValue ?? 100).toDouble();
  return max > min ? max : min + 1;
}

/// القيمة اللي السيرفر هيحسب بيها لو العميل ساب الحقل **الاختياري** — نفس
/// `resolvePricingFieldDefault` في الباك-إند بالحرف. للعرض بس: مابتتبعتش.
Object? pricingFieldDisplayDefault(PricingField field) {
  if (field.isRequired) return null;
  final raw = field.defaultValue;
  if (raw != null) {
    switch (field.fieldType) {
      case 'checkbox':
        return raw == 'true';
      case 'number':
      case 'slider':
      case 'area':
      case 'length':
      case 'volume':
        return num.tryParse(raw);
      default:
        return raw;
    }
  }
  if (field.fieldType == 'checkbox') return false;
  if (field.fieldType == 'slider') return field.minValue ?? 0;
  return null;
}

/// القيمة المبدئية اللي بتتحط في `fieldValues` أول ما الفورم يتحمّل — **نفس تهيئة الويب بالحرف**
/// (`booking-flow.tsx`): الافتراضي اللي الأدمن ضبطه بيتبعت فعلًا (number/slider رقم، checkbox
/// bool، غيره نص)، والـcheckbox من غير default بيبدأ false. `null` = الحقل يفضل فاضي لحد ما العميل
/// يجاوب. كان التطبيق بيملّي الـcheckbox بس، فحقل إجباري عليه default كان بيعدّي على الويب
/// ويتقفل على الموبايل (docs/08 §185، اتلقطت في مراجعة التكامل).
Object? pricingFieldInitialValue(PricingField field) {
  final raw = field.defaultValue;
  if (raw != null) {
    if (field.fieldType == 'number' || field.fieldType == 'slider') {
      final parsed = num.tryParse(raw);
      if (parsed == null) return raw;
      // عدّاد صحيح: int من المصدر زي أي قيمة العميل بيدخلها.
      return isIntegerSliderField(field) && parsed == parsed.roundToDouble() ? parsed.round() : parsed;
    }
    if (field.fieldType == 'checkbox') return raw == 'true';
    return raw;
  }
  return field.fieldType == 'checkbox' ? false : null;
}

/// أرقام عربية/فارسية وفاصلة عشرية عربية ⇒ صيغة `num.tryParse` بتفهمها. من غيرها العميل اللي
/// كيبورده عربي بيكتب «٣» والقيمة بتتبعت `null` في صمت.
num? parseLocalizedNumber(String input) {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  final buffer = StringBuffer();
  for (final char in input.trim().split('')) {
    final e = eastern.indexOf(char);
    final p = persian.indexOf(char);
    if (e >= 0) {
      buffer.write(e);
    } else if (p >= 0) {
      buffer.write(p);
    } else if (char == '٫' || char == ',') {
      buffer.write('.');
    } else {
      buffer.write(char);
    }
  }
  return num.tryParse(buffer.toString());
}

/// هل الحقل مكتمل؟ **نفس** شرط الشاشتين القديم بالحرف (الباك-إند بيرفض لو حقل مطلوب ناقص).
bool isPricingFieldComplete(PricingField field, Map<String, dynamic> values) {
  if (!field.isSupported) return true;
  final value = values[field.fieldKey];
  if (field.fieldType == 'image_upload') {
    final count = value is String
        ? value.split(',').where((id) => id.trim().isNotEmpty).length
        : 0;
    return count >= (field.minFiles ?? (field.isRequired ? 1 : 0));
  }
  return !field.isRequired || (value != null && value != '');
}

/// أول حقل ناقص بترتيب العرض — `null` لو كله تمام.
PricingField? firstIncompletePricingField(
  List<PricingField> fields,
  Map<String, dynamic> values,
) {
  final sorted = [...fields]..sort(comparePricingFields);
  for (final field in sorted) {
    if (!isPricingFieldComplete(field, values)) return field;
  }
  return null;
}

/// رسالة بتقول للعميل **يعمل إيه** في الحقل ده بالذات، مش «كمّل البيانات».
String pricingFieldMissingMessage(PricingField field, {String purpose = 'علشان نقدر نحسب السعر'}) {
  final label = field.labelAr.trim();
  switch (field.fieldType) {
    case 'dropdown':
    case 'multi_select':
      return 'اختار «$label» $purpose.';
    case 'image_upload':
      final minimum = field.minFiles ?? 1;
      return 'ارفع ${minimum > 1 ? '$minimum صور على الأقل' : 'صورة على الأقل'} في «$label» $purpose.';
    case 'date':
      return 'حدد التاريخ في «$label» $purpose.';
    case 'time':
      return 'حدد الوقت في «$label» $purpose.';
    case 'number':
    case 'area':
    case 'length':
    case 'volume':
      return 'اكتب «$label» $purpose.';
    default:
      return 'حدد «$label» $purpose.';
  }
}

/// وحدة تحكم الفورم من الشاشة الأم: «ودّيني لأول حقل ناقص».
class PricingFieldsFormController {
  _PricingFieldsFormState? _state;

  /// لو فيه حقل ناقص: بيعرض الرسالة تحته، يمرّر له، يركّز عليه لو نص، ويعلّمه لحظيًا.
  /// بيرجّع الحقل الناقص (عشان الشاشة الأم تعرض نفس الرسالة لو حبت)، أو `null` لو كله تمام.
  PricingField? revealFirstMissing({String purpose = 'علشان نقدر نحسب السعر'}) =>
      _state?._revealFirstMissing(purpose);
}

/// الفورم كامل: الحقول بترتيب `display_order` (مابيتغيّرش)، مفصولة بفواصل خفيفة، كل واحد
/// بمفتاح عشان التمرير له.
class PricingFieldsForm extends StatefulWidget {
  const PricingFieldsForm({
    super.key,
    required this.fields,
    required this.values,
    required this.onChanged,
    this.onUploadImage,
    this.controller,
  });

  final List<PricingField> fields;
  final Map<String, dynamic> values;
  final void Function(String fieldKey, dynamic value) onChanged;
  final PricingFieldImageUploader? onUploadImage;
  final PricingFieldsFormController? controller;

  @override
  State<PricingFieldsForm> createState() => _PricingFieldsFormState();
}

class _PricingFieldsFormState extends State<PricingFieldsForm> {
  final Map<String, GlobalKey> _keys = {};
  final Map<String, FocusNode> _focusNodes = {};
  final Map<String, String> _errors = {};
  String? _highlighted;
  Timer? _highlightTimer;

  @override
  void initState() {
    super.initState();
    widget.controller?._state = this;
  }

  @override
  void didUpdateWidget(covariant PricingFieldsForm oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller?._state = null;
      widget.controller?._state = this;
    }
  }

  @override
  void dispose() {
    if (widget.controller?._state == this) widget.controller?._state = null;
    _highlightTimer?.cancel();
    for (final node in _focusNodes.values) {
      node.dispose();
    }
    super.dispose();
  }

  GlobalKey _keyFor(String fieldKey) =>
      _keys.putIfAbsent(fieldKey, () => GlobalKey(debugLabel: 'pricing-$fieldKey'));

  FocusNode _focusFor(String fieldKey) =>
      _focusNodes.putIfAbsent(fieldKey, () => FocusNode(debugLabel: 'pricing-$fieldKey'));

  PricingField? _revealFirstMissing(String purpose) {
    final missing = firstIncompletePricingField(widget.fields, widget.values);
    if (missing == null) return null;
    setState(() {
      _errors[missing.fieldKey] = pricingFieldMissingMessage(missing, purpose: purpose);
      _highlighted = missing.fieldKey;
    });
    _highlightTimer?.cancel();
    _highlightTimer = Timer(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _highlighted = null);
    });
    // بعد الـframe اللي فيه رسالة الخطأ، عشان التمرير يحسب ارتفاع الحقل بيها.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _keys[missing.fieldKey]?.currentContext;
      if (target == null || !target.mounted) return;
      Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
        alignment: 0.12,
      ).then((_) {
        if (!mounted) return;
        if (_isTextField(missing)) _focusNodes[missing.fieldKey]?.requestFocus();
      });
    });
    return missing;
  }

  bool _isTextField(PricingField field) =>
      const {'number', 'area', 'length', 'volume'}.contains(field.fieldType);

  void _onChanged(String fieldKey, dynamic value) {
    if (_errors.containsKey(fieldKey)) setState(() => _errors.remove(fieldKey));
    widget.onChanged(fieldKey, value);
  }

  @override
  Widget build(BuildContext context) {
    final sorted = [...widget.fields]..sort(comparePricingFields);
    final children = <Widget>[];
    for (var i = 0; i < sorted.length; i++) {
      final field = sorted[i];
      if (i > 0) children.add(const Divider(height: 28));
      children.add(
        KeyedSubtree(
          key: _keyFor(field.fieldKey),
          child: buildPricingFieldWidget(
            context,
            field,
            widget.values,
            _onChanged,
            onUploadImage: widget.onUploadImage,
            errorText: _errors[field.fieldKey],
            highlighted: _highlighted == field.fieldKey,
            focusNode: _isTextField(field) ? _focusFor(field.fieldKey) : null,
          ),
        ),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
  }
}

// نقطة الدخول القديمة بنفس التوقيع (JobDetailsScreen/CreateOrderScreen/الاختبارات) + بارامترات
// اختيارية للخطأ والتعليم والتركيز. P0-10 (2026-08-13) هو اللي نقلها لملف مشترك بين الشاشتين.
Widget buildPricingFieldWidget(
  BuildContext context,
  PricingField field,
  Map<String, dynamic> fieldValues,
  void Function(String fieldKey, dynamic value) onChanged, {
  PricingFieldImageUploader? onUploadImage,
  String? errorText,
  bool highlighted = false,
  FocusNode? focusNode,
}) {
  // أنواع الحقول اللي لسه مش مدعومة (location/video_upload/voice_note) — راجع الملحوظة في
  // catalog/models.dart. لو مطلوب، بنمنع الإرسال في الشاشة المستدعية، وهنا بنوضّح السبب.
  if (!field.isSupported) {
    return _UnsupportedField(
      field: field,
      message: field.isRequired
          ? '«${field.labelAr}» محتاج تفاصيل (صورة/موقع) مش مدعومة في التطبيق لسه'
          : '«${field.labelAr}» اختياري ومش مدعوم في التطبيق حاليًا — هيتجاهل',
    );
  }

  final value = fieldValues[field.fieldKey];
  void emit(dynamic next) => onChanged(field.fieldKey, next);

  final Widget control;
  switch (field.fieldType) {
    case 'image_upload':
      control = _PricingImageField(
        key: ValueKey(field.id),
        field: field,
        value: value,
        onChanged: emit,
        onUpload: onUploadImage,
      );
    case 'number':
    case 'area':
    case 'length':
    case 'volume':
      control = _NumberInput(
        key: ValueKey('number-${field.id}'),
        field: field,
        value: value,
        onChanged: emit,
        focusNode: focusNode,
        hasError: errorText != null,
      );
    case 'dropdown':
      final options = field.options ?? const <PricingFieldOption>[];
      final selected = value as String? ?? pricingFieldDisplayDefault(field) as String?;
      control = options.length <= kInlineChoicesMaxCount
          ? _InlineChoices(options: options, selected: selected, onSelected: emit)
          : _ChoiceSheetSelector(
              title: field.labelAr,
              options: options,
              selected: selected,
              onSelected: emit,
              hasError: errorText != null,
            );
    case 'multi_select':
      final selected = value is List ? value.cast<String>() : const <String>[];
      control = _MultiChoices(
        options: field.options ?? const [],
        selected: selected,
        onChanged: (next) => emit(next.isEmpty ? null : next),
      );
    case 'checkbox':
      // الـcheckbox شكله مختلف: السؤال نفسه هو التسمية جنب المفتاح، مش عنوان فوق control.
      return _FieldFrame(
        highlighted: highlighted,
        errorText: errorText,
        child: _CheckboxRow(
          field: field,
          value: (value as bool?) ?? (pricingFieldDisplayDefault(field) as bool? ?? false),
          onChanged: emit,
        ),
      );
    case 'slider':
      control = usesQuantityStepper(field)
          ? _QuantityStepper(field: field, value: value as num?, onChanged: emit)
          : _PricingSlider(field: field, value: value as num?, onChanged: emit);
    case 'date':
      control = _PickerTile(
        icon: Icons.event_outlined,
        text: value as String? ?? 'اختار تاريخ',
        placeholder: value == null,
        onTap: () async {
          final picked = await showDatePicker(
            context: context,
            initialDate: DateTime.now(),
            firstDate: DateTime.now().subtract(const Duration(days: 365)),
            lastDate: DateTime.now().add(const Duration(days: 365)),
          );
          if (picked != null) {
            emit(
              '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}',
            );
          }
        },
      );
    case 'time':
      // وقت كـ«إجابة سؤال» (ميعاد تسليم مثلًا) — مش موعد الحجز، فمالوش علاقة بنافذة الحجز.
      control = _PickerTile(
        icon: Icons.schedule_outlined,
        text: value as String? ?? 'اختار وقت',
        placeholder: value == null,
        onTap: () async {
          final picked = await showTimePicker(context: context, initialTime: TimeOfDay.now());
          if (picked != null) {
            emit(
              '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
            );
          }
        },
      );
    default:
      // نوع مش متوقع (enum جديد في الباك-إند والتطبيق أقدم) — نفس معاملة غير المدعوم.
      return _UnsupportedField(
        field: field,
        message: field.isRequired
            ? '«${field.labelAr}» نوع حقل مش معروف — كلم الدعم'
            : '«${field.labelAr}» نوع حقل مش مدعوم، هيتجاهل',
      );
  }

  return _FieldFrame(
    highlighted: highlighted,
    errorText: errorText,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FieldHeader(field: field),
        const SizedBox(height: 10),
        control,
      ],
    ),
  );
}

/// عنوان السؤال + شرحه. بيلف على أي عدد سطور — مفيش ellipsis في أي نص هنا.
class _FieldHeader extends StatelessWidget {
  const _FieldHeader({required this.field});

  final PricingField field;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final helper = pricingFieldHelperText(field);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text.rich(
          TextSpan(
            text: bidiSafeText(field.labelAr),
            children: [
              if (field.isRequired)
                TextSpan(
                  text: ' *',
                  style: TextStyle(color: theme.colorScheme.error),
                ),
            ],
          ),
          style: theme.textTheme.titleSmall?.copyWith(height: 1.35),
          softWrap: true,
        ),
        if (helper != null) ...[
          const SizedBox(height: 4),
          Text(
            bidiSafeText(helper),
            softWrap: true,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              height: 1.45,
            ),
          ),
        ],
      ],
    );
  }
}

/// إطار الحقل: رسالة الخطأ تحته مباشرة، وتعليم لحظي لما الشاشة توصّل العميل له.
class _FieldFrame extends StatelessWidget {
  const _FieldFrame({required this.child, this.errorText, this.highlighted = false});

  final Widget child;
  final String? errorText;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: highlighted ? scheme.errorContainer.withValues(alpha: 0.35) : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          child,
          if (errorText != null) ...[
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.error_outline, size: 16, color: scheme.error),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    errorText!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.error),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _UnsupportedField extends StatelessWidget {
  const _UnsupportedField({required this.field, required this.message});

  final PricingField field;
  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Text(
        message,
        style: TextStyle(color: field.isRequired ? scheme.error : scheme.onSurfaceVariant),
      ),
    );
  }
}

/// اختيار واحد من قايمة قصيرة — كل اختيار كارت بعرض الشاشة، النص الطويل بيلف.
class _InlineChoices extends StatelessWidget {
  const _InlineChoices({required this.options, required this.selected, required this.onSelected});

  final List<PricingFieldOption> options;
  final String? selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const _NoOptions();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final option in options)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _ChoiceCard(
              label: option.labelAr,
              selected: option.value == selected,
              onTap: () => onSelected(option.value),
            ),
          ),
      ],
    );
  }
}

class _NoOptions extends StatelessWidget {
  const _NoOptions();

  @override
  Widget build(BuildContext context) => Text(
    'مفيش اختيارات متاحة للسؤال ده دلوقتي.',
    style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
  );
}

class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.label,
    required this.selected,
    required this.onTap,
    this.multi = false,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool multi;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final icon = multi
        ? (selected ? Icons.check_box : Icons.check_box_outline_blank)
        : (selected ? Icons.radio_button_checked : Icons.radio_button_unchecked);
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? scheme.primaryContainer.withValues(alpha: 0.55) : scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 1.6 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Icon(icon, size: 20, color: selected ? scheme.primary : scheme.onSurfaceVariant),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      bidiSafeText(label),
                      softWrap: true,
                      style: TextStyle(fontWeight: selected ? FontWeight.w600 : FontWeight.w400),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// قايمة طويلة: صف واحد بالاختيار الحالي، والضغط بيفتح bottom sheet قابل للتمرير.
class _ChoiceSheetSelector extends StatelessWidget {
  const _ChoiceSheetSelector({
    required this.title,
    required this.options,
    required this.selected,
    required this.onSelected,
    required this.hasError,
  });

  final String title;
  final List<PricingFieldOption> options;
  final String? selected;
  final ValueChanged<String> onSelected;
  final bool hasError;

  Future<void> _open(BuildContext context) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.75,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                  child: Text(bidiSafeText(title), style: Theme.of(sheetContext).textTheme.titleMedium),
                ),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    itemCount: options.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (_, index) {
                      final option = options[index];
                      return _ChoiceCard(
                        label: option.labelAr,
                        selected: option.value == selected,
                        onTap: () => Navigator.of(sheetContext).pop(option.value),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (picked != null) onSelected(picked);
  }

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const _NoOptions();
    final scheme = Theme.of(context).colorScheme;
    final current = options.where((o) => o.value == selected).firstOrNull;
    return _PickerTile(
      icon: Icons.list_alt_outlined,
      text: current?.labelAr ?? 'اختار من ${options.length} اختيارات',
      placeholder: current == null,
      borderColor: hasError ? scheme.error : null,
      trailing: Icons.expand_more,
      onTap: () => _open(context),
    );
  }
}

class _MultiChoices extends StatelessWidget {
  const _MultiChoices({required this.options, required this.selected, required this.onChanged});

  final List<PricingFieldOption> options;
  final List<String> selected;
  final ValueChanged<List<String>> onChanged;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const _NoOptions();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'تقدر تختار أكتر من اختيار',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        for (final option in options)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _ChoiceCard(
              label: option.labelAr,
              multi: true,
              selected: selected.contains(option.value),
              onTap: () {
                final next = [...selected];
                if (!next.remove(option.value)) next.add(option.value);
                onChanged(next);
              },
            ),
          ),
      ],
    );
  }
}

class _CheckboxRow extends StatelessWidget {
  const _CheckboxRow({required this.field, required this.value, required this.onChanged});

  final PricingField field;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => onChanged(!value),
      child: Row(
        children: [
          Expanded(child: _FieldHeader(field: field)),
          const SizedBox(width: 12),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

/// عدّاد صحيح لمدى صغير: [-] 3 قطع [+]. القيمة دايمًا int في حدود الحقل.
class _QuantityStepper extends StatelessWidget {
  const _QuantityStepper({required this.field, required this.value, required this.onChanged});

  final PricingField field;
  final num? value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final min = _sliderMin(field).round();
    final max = _sliderMax(field).round();
    final fallback = pricingFieldDisplayDefault(field) as num?;
    // حقل إجباري ما اتلمسش: «—» مش الحد الأدنى — الرقم ده لسه مش إجابة العميل، ولو عرضناه
    // هيفتكر إنه جاوب والسيرفر هيرفض «الحقل مطلوب».
    final current = (value ?? fallback)?.round().clamp(min, max);
    final unit = pricingFieldInlineUnit(field);
    final display = current == null ? '—' : (unit == null ? '$current' : '$current $unit');

    Widget button(IconData icon, String tooltip, VoidCallback? onPressed) => IconButton.outlined(
      tooltip: tooltip,
      onPressed: onPressed,
      icon: Icon(icon),
      style: IconButton.styleFrom(minimumSize: const Size(48, 48)),
    );

    return Row(
      children: [
        // RTL: «زوّد» على اليمين (بداية السطر) و«قلّل» على الشمال — نفس اتجاه القراية.
        button(
          Icons.add,
          'زوّد',
          current != null && current >= max ? null : () => onChanged(current == null ? (min + 1).clamp(min, max) : current + 1),
        ),
        Expanded(
          child: Text(
            display,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
        button(
          Icons.remove,
          'قلّل',
          current != null && current <= min ? null : () => onChanged(current == null ? min : current - 1),
        ),
      ],
    );
  }
}

/// slider: عدّاد صحيح بمدى كبير ⇒ divisions وقيمة int؛ حدود عشرية ⇒ السلوك القديم (متصل).
class _PricingSlider extends StatelessWidget {
  const _PricingSlider({required this.field, required this.value, required this.onChanged});

  final PricingField field;
  final num? value;
  final ValueChanged<num> onChanged;

  @override
  Widget build(BuildContext context) {
    final min = _sliderMin(field);
    final max = _sliderMax(field);
    final integer = isIntegerSliderField(field);
    final fallback = (pricingFieldDisplayDefault(field) as num?)?.toDouble() ?? min;
    final current = (value?.toDouble() ?? fallback).clamp(min, max).toDouble();
    final unit = pricingFieldInlineUnit(field);
    final shown = integer ? current.round().toString() : _trimDecimal(current);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: Text(
            unit == null ? shown : '$shown $unit',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
        Slider(
          min: min,
          max: max,
          value: current,
          // عدّاد صحيح: كل درجة = وحدة، فالإبهام مايقفش إلا على رقم صحيح.
          divisions: integer ? (max - min).round() : null,
          label: shown,
          // **من المصدر**: القيمة اللي بتتخزّن int للعدّاد — مش double بيتقرّب في العرض بس.
          onChanged: (next) => onChanged(integer ? next.round() : next),
        ),
      ],
    );
  }
}

String _trimDecimal(double value) {
  final fixed = value.toStringAsFixed(2);
  return fixed.replaceFirst(RegExp(r'\.?0+$'), '');
}

class _NumberInput extends StatefulWidget {
  const _NumberInput({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    required this.hasError,
    this.focusNode,
  });

  final PricingField field;
  final dynamic value;
  final ValueChanged<num?> onChanged;
  final FocusNode? focusNode;
  final bool hasError;

  @override
  State<_NumberInput> createState() => _NumberInputState();
}

class _NumberInputState extends State<_NumberInput> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.value?.toString() ?? '',
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final unit = pricingFieldInlineUnit(widget.field);
    final fallback = pricingFieldDisplayDefault(widget.field);
    final scheme = Theme.of(context).colorScheme;
    return TextField(
      controller: _controller,
      focusNode: widget.focusNode,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9٠-٩۰-۹.,٫]'))],
      textInputAction: TextInputAction.done,
      decoration: InputDecoration(
        // الـhint قصير عمدًا — السؤال نفسه مكتوب فوق الحقل.
        hintText: fallback != null
            ? 'لو سبته فاضي: $fallback'
            : widget.field.fieldType == 'number'
            ? 'أدخل العدد'
            : 'أدخل القيمة',
        suffixText: unit,
        border: const OutlineInputBorder(),
        enabledBorder: widget.hasError
            ? OutlineInputBorder(borderSide: BorderSide(color: scheme.error))
            : null,
      ),
      onChanged: (text) => widget.onChanged(text.trim().isEmpty ? null : parseLocalizedNumber(text)),
    );
  }
}

class _PickerTile extends StatelessWidget {
  const _PickerTile({
    required this.icon,
    required this.text,
    required this.placeholder,
    required this.onTap,
    this.trailing = Icons.chevron_left,
    this.borderColor,
  });

  final IconData icon;
  final String text;
  final bool placeholder;
  final VoidCallback onTap;
  final IconData trailing;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: borderColor ?? scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Icon(icon, size: 20, color: scheme.onSurfaceVariant),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    bidiSafeText(text),
                    softWrap: true,
                    style: TextStyle(
                      color: placeholder ? scheme.onSurfaceVariant : null,
                      fontWeight: placeholder ? FontWeight.w400 : FontWeight.w600,
                    ),
                  ),
                ),
                Icon(trailing, color: scheme.onSurfaceVariant),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PricingImageField extends StatefulWidget {
  const _PricingImageField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    required this.onUpload,
  });

  final PricingField field;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final PricingFieldImageUploader? onUpload;

  @override
  State<_PricingImageField> createState() => _PricingImageFieldState();
}

class _PricingImageFieldState extends State<_PricingImageField> {
  final _picker = ImagePicker();
  late List<_PricingImageEntry> _images;
  bool _uploading = false;
  String? _error;

  List<String> _idsFrom(dynamic value) => value is String
      ? value
            .split(',')
            .map((id) => id.trim())
            .where((id) => id.isNotEmpty)
            .toList()
      : <String>[];

  @override
  void initState() {
    super.initState();
    _images = _idsFrom(
      widget.value,
    ).map((id) => _PricingImageEntry(id: id)).toList();
  }

  @override
  void didUpdateWidget(covariant _PricingImageField oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextIds = _idsFrom(widget.value);
    final currentIds = _images.map((image) => image.id).toList();
    if (nextIds.join(',') != currentIds.join(',')) {
      _images = nextIds.map((id) => _PricingImageEntry(id: id)).toList();
    }
  }

  void _emit() {
    final value = _images.map((image) => image.id).join(',');
    widget.onChanged(value.isEmpty ? null : value);
  }

  Future<void> _pickImages() async {
    final uploader = widget.onUpload;
    if (uploader == null || _uploading) return;
    final maximum = widget.field.maxFiles ?? 5;
    final remaining = maximum - _images.length;
    if (remaining <= 0) return;

    final picked = await _picker.pickMultiImage(
      limit: remaining,
      imageQuality: 85,
      maxWidth: 1800,
    );
    if (picked.isEmpty || !mounted) return;

    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      for (final image in picked.take(remaining)) {
        final bytes = await image.readAsBytes();
        final id = await uploader(widget.field, image);
        if (!mounted) return;
        setState(() => _images.add(_PricingImageEntry(id: id, bytes: bytes)));
        _emit();
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final minimum = widget.field.minFiles ?? (widget.field.isRequired ? 1 : 0);
    final maximum = widget.field.maxFiles ?? 5;
    final enough = _images.length >= minimum;
    // العنوان والشرح في `_FieldHeader` فوق — هنا العدّاد والصور والزرار بس.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          minimum > 0
              ? 'ارفع من $minimum إلى $maximum صور (${_images.length}/$maximum)'
              : 'حتى $maximum صور (${_images.length}/$maximum)',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: enough
                ? Theme.of(context).colorScheme.onSurfaceVariant
                : Theme.of(context).colorScheme.error,
          ),
        ),
        if (_images.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _images.asMap().entries.map((entry) {
              final image = entry.value;
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 76,
                    height: 76,
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: image.bytes != null
                        ? Image.memory(image.bytes!, fit: BoxFit.cover)
                        : Center(child: Text('صورة ${entry.key + 1}')),
                  ),
                  PositionedDirectional(
                    top: -8,
                    end: -8,
                    child: IconButton.filledTonal(
                      visualDensity: VisualDensity.compact,
                      iconSize: 16,
                      tooltip: 'حذف الصورة',
                      onPressed: _uploading
                          ? null
                          : () {
                              setState(() => _images.removeAt(entry.key));
                              _emit();
                            },
                      icon: const Icon(Icons.close),
                    ),
                  ),
                ],
              );
            }).toList(),
          ),
        ],
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: _uploading || _images.length >= maximum ? null : _pickImages,
          icon: _uploading
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.add_photo_alternate_outlined),
          label: Text(_uploading ? 'جاري رفع الصور...' : 'اختار صور'),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
      ],
    );
  }
}

class _PricingImageEntry {
  const _PricingImageEntry({required this.id, this.bytes});

  final String id;
  final Uint8List? bytes;
}
