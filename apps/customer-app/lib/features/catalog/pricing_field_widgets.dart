import 'package:flutter/material.dart';
import 'models.dart';

// فورم حقول التسعير الديناميكي (خدمات pricing_model=formula) — كانت منطقها بالكامل جوّه
// CreateOrderScreen (طلب واحد، فني معروف بالفعل). P0-10 (2026-08-13، مراجعة أمان/جودة شاملة):
// رحلة اختيار الفني كانت بتحصل *قبل* ما العميل يملى الحقول دي أصلاً، فقايمة الفنيين لخدمات
// formula كانت بتعرض "بدون سعر" لكل الفنيين (final_price_cents محتاج field_values عشان يتحسب —
// راجع apps/api/src/modules/catalog/catalog.controller.ts). الحل: JobDetailsScreen بتجمع
// field_values الأول (قبل شاشة اختيار الفني)، فمحتاجين نفس منطق رسم الحقول ديه في الشاشتين
// (JobDetailsScreen وCreateOrderScreen — التانية لسه محتاجاها لمسار "اختيار فني محدد عبر سلوت
// جدولة" اللي بيوديك لـCreateOrderScreen مباشرة بلا قايمة فنيين، ومسار "إعادة الحجز"). اتقلعت
// هنا بدل التكرار.
Widget buildPricingFieldWidget(
  BuildContext context,
  PricingField field,
  Map<String, dynamic> fieldValues,
  void Function(String fieldKey, dynamic value) onChanged,
) {
  // أنواع الحقول اللي لسه مش مدعومة (location/image_upload/video_upload/voice_note) — راجع
  // الملحوظة في catalog/models.dart. لو مطلوب، بنمنع الإرسال في الشاشة المستدعية، وهنا بس
  // بنوضّح للعميل ليه الحقل ده مش ظاهر كمدخل فعلي.
  if (!field.isSupported) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Text(
        field.isRequired
            ? '⚠️ "${field.labelAr}" محتاج تفاصيل (صورة/موقع) مش مدعومة في التطبيق لسه'
            : '"${field.labelAr}" اختياري ومش مدعوم في التطبيق حاليًا — هيتجاهل',
        style: TextStyle(color: field.isRequired ? Colors.red : Colors.grey),
      ),
    );
  }

  final label = field.unitAr != null ? '${field.labelAr} (${field.unitAr})' : field.labelAr;

  switch (field.fieldType) {
    case 'number':
    case 'area':
    case 'length':
    case 'volume':
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: TextFormField(
          initialValue: fieldValues[field.fieldKey]?.toString(),
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (value) {
            final parsed = num.tryParse(value);
            onChanged(field.fieldKey, parsed);
          },
        ),
      );

    case 'dropdown':
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: DropdownButtonFormField<String>(
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
          initialValue: fieldValues[field.fieldKey] as String?,
          items: (field.options ?? [])
              .map((o) => DropdownMenuItem(value: o.value, child: Text(o.labelAr)))
              .toList(),
          onChanged: (value) => onChanged(field.fieldKey, value),
        ),
      );

    case 'multi_select':
      final selected = (fieldValues[field.fieldKey] as List<String>?) ?? <String>[];
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            Wrap(
              spacing: 8,
              children: (field.options ?? [])
                  .map(
                    (o) => FilterChip(
                      label: Text(o.labelAr),
                      selected: selected.contains(o.value),
                      onSelected: (isSelected) {
                        final updated = [...selected];
                        if (isSelected) {
                          updated.add(o.value);
                        } else {
                          updated.remove(o.value);
                        }
                        onChanged(field.fieldKey, updated.isEmpty ? null : updated);
                      },
                    ),
                  )
                  .toList(),
            ),
          ],
        ),
      );

    case 'checkbox':
      return SwitchListTile(
        title: Text(label),
        value: (fieldValues[field.fieldKey] as bool?) ?? false,
        onChanged: (value) => onChanged(field.fieldKey, value),
      );

    case 'slider':
      final min = (field.minValue ?? 0).toDouble();
      final effectiveMax = (field.maxValue ?? 100).toDouble();
      final max = effectiveMax > min ? effectiveMax : min + 1;
      final current = ((fieldValues[field.fieldKey] as num?)?.toDouble() ?? min).clamp(min, max).toDouble();
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$label: ${current.toStringAsFixed(0)}'),
            Slider(
              min: min,
              max: max,
              value: current,
              onChanged: (value) => onChanged(field.fieldKey, value),
            ),
          ],
        ),
      );

    case 'date':
      final currentValue = fieldValues[field.fieldKey] as String?;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4), side: BorderSide(color: Theme.of(context).dividerColor)),
          title: Text(label),
          subtitle: Text(currentValue ?? 'اختار تاريخ'),
          onTap: () async {
            final picked = await showDatePicker(
              context: context,
              initialDate: DateTime.now(),
              firstDate: DateTime.now().subtract(const Duration(days: 365)),
              lastDate: DateTime.now().add(const Duration(days: 365)),
            );
            if (picked != null) {
              final formatted = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
              onChanged(field.fieldKey, formatted);
            }
          },
        ),
      );

    case 'time':
      final currentValue = fieldValues[field.fieldKey] as String?;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4), side: BorderSide(color: Theme.of(context).dividerColor)),
          title: Text(label),
          subtitle: Text(currentValue ?? 'اختار وقت'),
          onTap: () async {
            final picked = await showTimePicker(context: context, initialTime: TimeOfDay.now());
            if (picked != null) {
              final formatted = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
              onChanged(field.fieldKey, formatted);
            }
          },
        ),
      );

    default:
      // نوع مش متوقع (enum جديد اتضاف في الباك-إند ومحدّش حدّث الفرونت) — نفس معاملة الأنواع
      // الغير مدعومة (isSupported=false)، عشان مانضربش خطأ غير واضح للعميل.
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(
          field.isRequired ? '⚠️ "${field.labelAr}" نوع حقل مش معروف — كلم الدعم' : '"${field.labelAr}" نوع حقل مش مدعوم، هيتجاهل',
          style: TextStyle(color: field.isRequired ? Colors.red : Colors.grey),
        ),
      );
  }
}
