import 'package:flutter/material.dart';

/// **مصدر واحد لقيمة `scheduled_at` اللي بتتبعت في الحجز** (docs/08 §150 بند ١، ADR-0090).
///
/// الرحلة بتعدّي على تلات نداءات بتبعت نفس الحقل: تذكرة المعاينة في شاشة اختيار الفني، إعادة
/// إصدار التذكرة في شاشة التأكيد، وإنشاء الطلب نفسه. كل واحدة فيهم كانت بتبني القيمة بإيدها.
///
/// البَقّة اللي اتلقطت حيًا (بلاغ مالك 2026-09-15): شاشة اختيار الفني كانت بتبعت **اليوم بس**
/// (`requestedAt` بلا `requestedPreciseTime`) وشاشة التأكيد بتبعت **اليوم + الساعة** — فالعميل
/// اللي اختار ساعة من حوار الاقتراح بياخد «غيّرت في تفاصيل الحجز بعد ما اخترت الفني (الموعد)»
/// وهو ماغيّرش أي حاجة. والحالة دي بتضرب كل خدمة `requires_start_time_only`، وهي الافتراضي.
///
/// الباك-إند اتقفل بنيويًا كمان (البصمة بقت بتقارن **يوم المنصّة** مش اللحظة — ساعة اليوم
/// مابتغيّرش لا السعر ولا المرشّح). الدالة دي الطبقة التانية: التذكرة والطلب يشوفوا نفس الوقت
/// بالحرف، فالسعر المعروض والمحفوظ واحد ومفيش اعتماد على تسامح السيرفر.
DateTime? bookingScheduledAt({
  required bool requiresStartTime,
  required DateTime? day,
  required TimeOfDay? preciseTime,
}) {
  if (day == null) return null;
  if (!requiresStartTime || preciseTime == null) return day;
  return DateTime(
    day.year,
    day.month,
    day.day,
    preciseTime.hour,
    preciseTime.minute,
  );
}

/// نفس القيمة فوق بصيغة الإرسال (UTC/ISO-8601) — عشان التحويل نفسه مايتكتبش في كل نداء.
String? bookingScheduledAtIso({
  required bool requiresStartTime,
  required DateTime? day,
  required TimeOfDay? preciseTime,
}) => bookingScheduledAt(
  requiresStartTime: requiresStartTime,
  day: day,
  preciseTime: preciseTime,
)?.toUtc().toIso8601String();
