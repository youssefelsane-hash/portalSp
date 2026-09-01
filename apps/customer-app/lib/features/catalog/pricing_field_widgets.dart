import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'models.dart';

typedef PricingFieldImageUploader =
    Future<String> Function(PricingField field, XFile image);

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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${widget.field.labelAr}${widget.field.isRequired ? ' *' : ''}',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 4),
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
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerHighest,
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
            onPressed: _uploading || _images.length >= maximum
                ? null
                : _pickImages,
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
      ),
    );
  }
}

class _PricingImageEntry {
  const _PricingImageEntry({required this.id, this.bytes});

  final String id;
  final Uint8List? bytes;
}

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
  void Function(String fieldKey, dynamic value) onChanged, {
  PricingFieldImageUploader? onUploadImage,
}) {
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

  final label = field.unitAr != null
      ? '${field.labelAr} (${field.unitAr})'
      : field.labelAr;

  switch (field.fieldType) {
    case 'image_upload':
      return _PricingImageField(
        key: ValueKey(field.id),
        field: field,
        value: fieldValues[field.fieldKey],
        onChanged: (value) => onChanged(field.fieldKey, value),
        onUpload: onUploadImage,
      );
    case 'number':
    case 'area':
    case 'length':
    case 'volume':
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: TextFormField(
          initialValue: fieldValues[field.fieldKey]?.toString(),
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
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
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
          initialValue: fieldValues[field.fieldKey] as String?,
          items: (field.options ?? [])
              .map(
                (o) => DropdownMenuItem(value: o.value, child: Text(o.labelAr)),
              )
              .toList(),
          onChanged: (value) => onChanged(field.fieldKey, value),
        ),
      );

    case 'multi_select':
      final selected =
          (fieldValues[field.fieldKey] as List<String>?) ?? <String>[];
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
                        onChanged(
                          field.fieldKey,
                          updated.isEmpty ? null : updated,
                        );
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
      final current = ((fieldValues[field.fieldKey] as num?)?.toDouble() ?? min)
          .clamp(min, max)
          .toDouble();
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
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(4),
            side: BorderSide(color: Theme.of(context).dividerColor),
          ),
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
              final formatted =
                  '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
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
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(4),
            side: BorderSide(color: Theme.of(context).dividerColor),
          ),
          title: Text(label),
          subtitle: Text(currentValue ?? 'اختار وقت'),
          onTap: () async {
            final picked = await showTimePicker(
              context: context,
              initialTime: TimeOfDay.now(),
            );
            if (picked != null) {
              final formatted =
                  '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
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
          field.isRequired
              ? '⚠️ "${field.labelAr}" نوع حقل مش معروف — كلم الدعم'
              : '"${field.labelAr}" نوع حقل مش مدعوم، هيتجاهل',
          style: TextStyle(color: field.isRequired ? Colors.red : Colors.grey),
        ),
      );
  }
}
