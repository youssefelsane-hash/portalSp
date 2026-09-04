/// صياغة موحّدة لـ«حجم الشغلانة» زي ما العميل بيقراها — المدة وعدد الأفراد.
///
/// **البَقّة اللي الملف ده بيقفلها** (بلاغ مالك 2026-09-04): العميل اختار شغلانة تنظيف
/// **ساعتين**، والشاشة قالت له «المدة المتوقعة: يوم واحد — ١ صنايعي». السبب مكانش في محرك
/// التسعير: `duration_minutes` كانت راجعة صح في `POST /orders/preview` و`GET /orders/:id`
/// الاتنين، لكن الواجهة كانت بتقرا `estimated_duration_days` بس وتكتب «يوم» جنبها. أي شغلانة
/// أقل من يوم كانت بتتقرّب لـ«يوم واحد» في عين العميل.
///
/// القاعدة: **الدقايق أدق فبتكسب لما تكون موجودة**؛ الأيام للشغل اللي فعلاً بيمتد على أيام.
/// مكان واحد بس بيعرف الصياغة دي، فكل شاشة بتستخدمه بتقول نفس الكلام بالحرف.
library;

/// نص المدة، أو `null` لو مفيش أي تقدير — الواجهة ساعتها ما تعرضش السطر أصلاً.
String? formatWorkDuration({int? minutes, num? days}) {
  if (minutes != null && minutes > 0) {
    // شغل ممتد على أيام بيتكتب بالأيام حتى لو الدقايق موجودة — «٢٨٨٠ دقيقة» مش معلومة مفيدة.
    if (days != null && days >= 1 && minutes >= 24 * 60) return _daysLabel(days);
    return _minutesLabel(minutes);
  }
  if (days != null && days > 0) return _daysLabel(days);
  return null;
}

/// «١ متخصص» / «٢ متخصصين» + المساعدين لو فيه.
///
/// كلمة «صنايعي» اتشالت بطلب المالك: المنصة فيها خدمات مش حرفية (جليسة أطفال، تنظيف، رعاية)،
/// فالكلمة كانت بتوصف جزء من الشغل بس. «متخصص» بتنفع لكل الفئات.
String? formatWorkforce({int? technicians, int? assistants}) {
  final parts = <String>[];
  if (technicians != null && technicians > 0) parts.add(_countLabel(technicians, 'متخصص', 'متخصصين'));
  if (assistants != null && assistants > 0) parts.add(_countLabel(assistants, 'مساعد', 'مساعدين'));
  return parts.isEmpty ? null : parts.join(' + ');
}

String _minutesLabel(int minutes) {
  if (minutes < 60) return _countLabel(minutes, 'دقيقة', 'دقايق');
  final hours = minutes / 60;
  final rest = minutes % 60;
  if (rest == 0) return _countLabel(minutes ~/ 60, 'ساعة', 'ساعات');
  // «ساعة ونص» أوضح بكتير من «١.٥ ساعة» في الاستخدام اليومي.
  if (rest == 30) return '${_countLabel(minutes ~/ 60, 'ساعة', 'ساعات')} ونص';
  return '${hours.toStringAsFixed(1)} ساعة';
}

String _daysLabel(num days) {
  final whole = days % 1 == 0 ? days.toInt() : null;
  if (whole != null) return _countLabel(whole, 'يوم', 'أيام');
  return '${days.toStringAsFixed(1)} يوم';
}

/// تصريف عربي مبسّط بس صحيح للأعداد الشايعة: ١ مفرد، ٢ مثنى، ٣–١٠ جمع، ١١+ تمييز مفرد.
String _countLabel(int count, String singular, String plural) {
  if (count == 1) return '$singular واحد';
  if (count == 2) return _dual(singular);
  if (count <= 10) return '$count $plural';
  return '$count $singular';
}

String _dual(String singular) {
  if (singular.endsWith('ة')) return '${singular.substring(0, singular.length - 1)}تين';
  return '$singularين';
}
