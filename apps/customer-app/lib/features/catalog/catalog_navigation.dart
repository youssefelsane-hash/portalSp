import 'package:flutter/material.dart';
import '../orders/create_order_screen.dart';
import '../orders/job_details_screen.dart';
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
  Navigator.of(context).push(
    MaterialPageRoute(
      // نفس منطق ServicesScreen الأصلي بالحرف (P0-10، 2026-08-13): فردي وpricing_model=formula
      // لازم يجمع تفاصيل الشغل (JobDetailsScreen) قبل قايمة الفنيين، فردي وسعر ثابت يروح لقايمة
      // الفنيين مباشرة، اعتماد/طوارئ يروحوا CreateOrderScreen (فيها اختيار شركة/فريق أو توزيع تلقائي).
      builder: (_) => bookingMode != BookingMode.individual
          ? CreateOrderScreen(service: service, bookingMode: bookingMode)
          : service.pricingModel == 'formula'
              ? JobDetailsScreen(service: service)
              : TechnicianSelectionScreen(service: service),
    ),
  );
}
