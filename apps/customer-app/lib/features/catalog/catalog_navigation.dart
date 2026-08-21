import 'package:flutter/material.dart';
import '../orders/create_order_screen.dart';
import '../orders/job_details_screen.dart';
import '../orders/schedule_selection_screen.dart';
import '../technicians/technician_selection_screen.dart';
import 'booking_mode_selector.dart';
import 'models.dart';

// Script 3 §6/§59 — نقطة تنقّل واحدة لكل مسارات اكتشاف الخدمة (فئات، بحث، لاحقًا: صوت/صورة) —
// "All paths must converge into the SAME booking architecture. Do NOT build six booking engines."
// كانت الشجرة دي مكررة داخل ServicesScreen بس؛ اتفصلت هنا عشان HomeScreen/SearchResultsScreen
// يستخدموها بنفس السلوك بالظبط بلا تكرار.
//
// وضع الحجز بقى بيتقرر هنا (بعد اختيار الخدمة)، مش قبلها — لو الخدمة بتدعم وضع واحد بس
// (الحالة الشائعة، allowsIndividual افتراضيًا) بيتخطى سؤال "إزاي حابب تحجز؟" تمامًا.
Future<void> navigateToServiceBooking(BuildContext context, CatalogService service) async {
  final availableModes = service.availableBookingModes;
  if (availableModes.isEmpty) return; // مفيش وضع حجز مسموح للخدمة دي أصلاً — حالة بيانات غير متوقعة، تجاهل بأمان

  final BookingMode bookingMode;
  if (availableModes.length == 1) {
    bookingMode = availableModes.first;
  } else {
    final chosen = await showBookingModeSelector(context, availableModes);
    if (chosen == null || !context.mounted) return; // العميل قفل الـsheet من غير اختيار
    bookingMode = chosen;
  }

  if (!context.mounted) return;

  // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — خطوة إجبارية بعد وضع الحجز مباشرة، قبل أي تفاصيل
  // تانية (نفس ترتيب المالك: وضع الحجز → تفاصيل الشغل → الموعد المطلوب → العنوان → ...).
  // الطوارئ مستثناة عمدًا — استجابة فورية بالتعريف (orders.service.ts بيرفض scheduled_at مع
  // بوكينج طوارئ بوضوح)، فسؤال "امتى؟" هنا مضلّل مش مفيد.
  DateTime? scheduledAt;
  DateTime? scheduledAtRangeEnd;
  if (bookingMode != BookingMode.emergency) {
    final choice = await Navigator.of(context).push<ScheduleChoice>(
      MaterialPageRoute(builder: (_) => const ScheduleSelectionScreen()),
    );
    if (choice == null || !context.mounted) return; // العميل رجع من غير ما يختار — نلغي الحجز كله
    scheduledAt = choice.scheduledAt;
    scheduledAtRangeEnd = choice.rangeEnd;
  }

  if (!context.mounted) return;
  Navigator.of(context).push(
    MaterialPageRoute(
      // إصلاح بَقّة حقيقية اتبلّغت من المالك (docs/08 §36، 2026-08-21): اعتماد (team) كان متجمّع
      // مع طوارئ في الفرع القديم ده — بيروح CreateOrderScreen على طول، فيتخطى خطوة العنوان/تفاصيل
      // الشغل وخطوة اختيار الفريق المنفصلتين اللي فردي بياخدهم. طلب المالك صريح: "خلي الفلو بتاع
      // اعتماد هو هو نفس الفلو بتاع شغلانة وسيطة أو خفيفة" — فردي واعتماد بقوا بياخدوا **نفس**
      // الفرع (formula → JobDetailsScreen، سعر ثابت → TechnicianSelectionScreen مباشرة)، وbookingMode
      // بتتمرر تحت عشان الشاشتين تعرفوا يفرّقوا (اختيار فني فردي مقابل اختيار شركة/فريق). طوارئ
      // بس هو اللي فضل بيروح CreateOrderScreen مباشرة — تصرف مقصود وموثّق (استجابة فورية بالتعريف،
      // نفس استثناء ScheduleSelectionScreen فوق).
      builder: (_) => bookingMode == BookingMode.emergency
          ? CreateOrderScreen(
              service: service,
              bookingMode: bookingMode,
              requestedAt: scheduledAt,
              requestedAtRangeEnd: scheduledAtRangeEnd,
            )
          : service.pricingModel == 'formula'
              ? JobDetailsScreen(
                  service: service,
                  bookingMode: bookingMode,
                  requestedAt: scheduledAt,
                  requestedAtRangeEnd: scheduledAtRangeEnd,
                )
              : TechnicianSelectionScreen(
                  service: service,
                  bookingMode: bookingMode,
                  requestedAt: scheduledAt,
                  requestedAtRangeEnd: scheduledAtRangeEnd,
                ),
    ),
  );
}
