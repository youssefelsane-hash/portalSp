String formatScheduledDayAr(String? iso, {DateTime? now}) {
  if (iso == null) return 'موعد فوري';

  final at = DateTime.parse(iso).toLocal();
  final current = (now ?? DateTime.now()).toLocal();
  final serviceDay = DateTime(at.year, at.month, at.day);
  final today = DateTime(current.year, current.month, current.day);
  final diffDays = serviceDay.difference(today).inDays;
  if (diffDays == 0) return 'النهاردة';
  if (diffDays == 1) return 'بكرة';

  String two(int value) => value.toString().padLeft(2, '0');
  const weekdays = [
    'الاتنين',
    'التلات',
    'الأربع',
    'الخميس',
    'الجمعة',
    'السبت',
    'الحد',
  ];
  return '${weekdays[at.weekday - 1]} ${two(at.day)}/${two(at.month)}/${at.year}';
}

bool isScheduledToday(String? iso, {DateTime? now}) {
  if (iso == null) return false;
  final at = DateTime.parse(iso).toLocal();
  final current = (now ?? DateTime.now()).toLocal();
  return at.year == current.year &&
      at.month == current.month &&
      at.day == current.day;
}
