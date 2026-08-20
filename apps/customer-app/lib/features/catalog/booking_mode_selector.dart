import 'package:flutter/material.dart';
import 'models.dart';

// Script 3 §32/§35 — كانت الشاشة دي بوابة دخول إجبارية (BookingModeScreen) بتظهر فورًا بعد
// تسجيل الدخول، قبل ما العميل يشوف/يفهم الخدمة أصلاً — بالظبط الـanti-pattern اللي السكريبت
// بيحذّر منه صراحة ("must NOT lead with Individual/Team/Company before customer explains what
// they need"). دلوقتي bottom sheet سياقي بيظهر بس بعد ما العميل يختار خدمة، وبس لو الخدمة دي
// فعلاً بتدعم أكتر من وضع حجز (availableBookingModes.length > 1) — خدمة بسيطة (allowsIndividual
// بس، الافتراضي) بتتخطى الخطوة دي تمامًا (بند 35: "Do not show Company/Team unnecessarily for
// simple services").
Future<BookingMode?> showBookingModeSelector(BuildContext context, List<BookingMode> availableModes) {
  assert(availableModes.length > 1, 'مفيش داعي تعرض اختيار لو وضع واحد بس متاح');
  return showModalBottomSheet<BookingMode>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text('إزاي حابب تحجز الخدمة دي؟', style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              for (final mode in availableModes) ...[
                _BookingModeCard(mode: mode, onTap: () => Navigator.of(context).pop(mode)),
                const SizedBox(height: 12),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}

class _BookingModeCard extends StatelessWidget {
  final BookingMode mode;
  final VoidCallback onTap;

  const _BookingModeCard({required this.mode, required this.onTap});

  // "سريعة/بسرعة" اتشالت من وصف الوضع الفردي (docs/08 §32.3، طلب مالك صريح 2026-08-20) — كانت
  // بتوحي بالاستعجال وتتلخبط مع وضع "طوارئ" الفعلي تحت.
  (IconData, String, Color?) get _presentation => switch (mode) {
        BookingMode.individual => (Icons.person_outline, 'فردي — فني واحد بيتولى الشغلانة', null),
        BookingMode.team => (Icons.groups_outlined, 'اعتماد — شغلانة كبيرة محتاجة فريق أو شركة', null),
        BookingMode.emergency => (Icons.bolt_outlined, 'طوارئ — حجز فوري، استجابة أسرع', Colors.red),
      };

  @override
  Widget build(BuildContext context) {
    final (icon, subtitle, color) = _presentation;
    final accent = color ?? Theme.of(context).colorScheme.primary;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(backgroundColor: accent.withValues(alpha: 0.15), foregroundColor: accent, child: Icon(icon)),
              const SizedBox(width: 16),
              Expanded(child: Text(subtitle, style: Theme.of(context).textTheme.titleMedium)),
              const Icon(Icons.chevron_left),
            ],
          ),
        ),
      ),
    );
  }
}
