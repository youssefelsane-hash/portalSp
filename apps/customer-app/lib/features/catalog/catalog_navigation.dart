import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_gate.dart';
import '../../core/auth_repository.dart';
import '../orders/create_order_screen.dart';
import '../orders/job_details_screen.dart';
import '../orders/schedule_selection_screen.dart';
import '../technicians/technician_selection_screen.dart';
import 'models.dart';

// Script 3 §6/§59 — نقطة تنقّل واحدة لكل مسارات اكتشاف الخدمة (فئات، بحث، لاحقًا: صوت/صورة) —
// "All paths must converge into the SAME booking architecture. Do NOT build six booking engines."
// كانت الشجرة دي مكررة داخل ServicesScreen بس؛ اتفصلت هنا عشان HomeScreen/SearchResultsScreen
// يستخدموها بنفس السلوك بالظبط بلا تكرار.
//
// **وضع الحجز مابقاش بيتسأل خالص (ADR-0048)** — بيتشتق في الباك-إند من اليوم المختار وعدد
// العمال المطلوب. الخطوة الوحيدة اللي العميل بيشوفها بعد اختيار الخدمة هي **الميعاد**.
Future<void> navigateToServiceBooking(BuildContext context, CatalogService service) async {
  final availableModes = service.availableBookingModes;
  if (availableModes.isEmpty) return; // مفيش وضع حجز مسموح للخدمة دي أصلاً — حالة بيانات غير متوقعة، تجاهل بأمان
  // ملاحظة: `availableBookingModes` بقت تُستخدم هنا كفحص "الخدمة قابلة للحجز أصلاً" بس — مش
  // كقايمة اختيارات تتعرض للعميل (ADR-0048).

  // **بوابة الزائر (docs/08 §77-B1، طلب مالك صريح)** — هنا بالظبط، ومكان تاني غلط.
  //
  // الدالة دي هي نقطة الالتقاء الوحيدة لكل مسارات اكتشاف الخدمة (فئات، بحث، الرئيسية، وأي
  // مسار يتضاف بعدين — ده مبدأ مثبّت في التعليق فوق من Script 3). حط البوابة هنا معناه إن
  // **مستحيل** يفضل مسار حجز بلا تسجيل، بلا ما نفتكر نحط فحص في كل شاشة.
  //
  // والتوقيت مطابق لطلب المالك بالحرف: «قبل ما يطلع له أي سعر أو أول ما يدوس على خدمة محددة».
  // الخطوة اللي بعد السطر ده مباشرةً هي اختيار وضع الحجز ← الموعد ← السعر.
  //
  // `ensureSignedIn` بترجّع `false` لو العميل اختار يفضل يتفرّج — بنخرج بهدوء، والعميل
  // بيفضل في نفس الشاشة اللي كان فيها. ولو سجّل، الرحلة بتكمّل من السطر اللي بعده بنفس
  // الخدمة — «تروح جاي الصفحة أوتوماتيك مرجعة اللي هو كان بيعمله على طول».
  final signedIn = await ensureSignedIn(
    context,
    reason: 'عشان نحجزلك «${service.nameAr}» محتاجين نعرف عنوانك ونقدر نتواصل معاك.',
    headline: 'كمّل حجز «${service.nameAr}»',
  );
  if (!signedIn || !context.mounted) return;

  // ADR-0046 — إشارة "العميل بدأ حجز الخدمة دي". لو ما كمّلش، الاسترجاع بيفكّره بعد ساعة.
  // النقطة دي بالذات لأنها مكان التقاء **كل** مسارات اكتشاف الخدمة (فئات/بحث/الرئيسية).
  _recordServiceIntent(context, service.id);

  // **سؤال «إزاي حابب تحجز الخدمة دي؟» اتشال نهائيًا (ADR-0048، طلب مالك صريح، docs/08 §85)**:
  // «بدل ما أسأل الكاستمر عايز شغلنا طوارئ ولا فوري ولا فردي، نشيل دول خالص ونحط قواعد على
  // السيستم، والسيستم هو اللي بيحدد بناءً على التاريخ».
  //
  // فالخطوة الأولى بقت **الميعاد دايمًا**، لكل الخدمات بلا استثناء. الوضع (طوارئ/فريق/فردي)
  // بيتحسب في الباك-إند من اليوم المختار وعدد العمال المطلوب، والعميل مابيشوفش المصطلحات دي
  // خالص — بيشوف تنبيه أحمر واضح لو اختار النهارده إن فيه رسوم استعجال، وبس.
  final choice = await Navigator.of(context).push<ScheduleChoice>(
    MaterialPageRoute(
      builder: (_) => ScheduleSelectionScreen(
        allowsDateRangeBooking: service.allowsDateRangeBooking,
        requiresPreciseTime: service.requiresStartTime,
        allowsSameDay: service.allowsEmergency,
      ),
    ),
  );
  if (choice == null || !context.mounted) return; // العميل رجع من غير ما يختار — نلغي الحجز كله
  final DateTime scheduledAt = choice.scheduledAt;
  final DateTime? scheduledAtRangeEnd = choice.rangeEnd;
  final TimeOfDay? preciseTime = choice.preciseTime;

  // الوضع المحلي ده **للتنقّل بس** — الباك-إند بيعيد اشتقاقه من جديد بتوقيت القاهرة وهو المرجع
  // الوحيد (ADR-0048 §1). اليوم المختار هو النهارده ⇒ خدمة مستعجلة ⇒ مفيش خطوة اختيار فني
  // (أول فني يقبل هو اللي بيروح)، بالظبط زي ما الطوارئ كانت بتشتغل قبل كده.
  final BookingMode bookingMode = _isSameDayLocal(scheduledAt)
      ? BookingMode.emergency
      : (availableModes.contains(BookingMode.individual) ? BookingMode.individual : availableModes.first);

  if (!context.mounted) return;
  Navigator.of(context).push(
    MaterialPageRoute(
      // فلو "اعتماد" موحّد مع "فردي" بالحرف (docs/08 §36+§38، طلب مالك صريح 2026-08-21 — اتصلحت
      // بشكل مستقل في سيشنين متوازيين بنفس الفرع بالظبط) — الفرق الوحيد بينهم بقى فلترة مستوى
      // الفني + دمج الشركات جوّه TechnicianMarketplaceScreen نفسها (booking_mode بيتمرر لحد هناك)،
      // مش مسار تنقّل مختلف. الطوارئ بس (حجز فوري بالتصميم، مفيش اختيار يدوي خالص) بتروح
      // CreateOrderScreen مباشرة زي ما كانت دايمًا.
      builder: (_) => bookingMode == BookingMode.emergency
          ? CreateOrderScreen(
              service: service,
              bookingMode: bookingMode,
              requestedAt: scheduledAt,
              requestedAtRangeEnd: scheduledAtRangeEnd,
              requestedPreciseTime: preciseTime,
            )
          : service.pricingModel == 'formula'
              ? JobDetailsScreen(
                  service: service,
                  bookingMode: bookingMode,
                  requestedAt: scheduledAt,
                  requestedAtRangeEnd: scheduledAtRangeEnd,
                  requestedPreciseTime: preciseTime,
                )
              : TechnicianSelectionScreen(
                  service: service,
                  bookingMode: bookingMode,
                  requestedAt: scheduledAt,
                  requestedAtRangeEnd: scheduledAtRangeEnd,
                  requestedPreciseTime: preciseTime,
                ),
    ),
  );
}

/// هل اليوم المختار هو النهارده؟ (ADR-0048)
///
/// **بتوقيت الجهاز عمدًا، والباك-إند بيعيد الحساب بتوقيت القاهرة وهو المرجع.** لو ساعة الجهاز
/// غلط، أسوأ نتيجة إن العميل ياخد شاشة اختيار فني وهو مش محتاجها (أو العكس) — السعر والتوزيع
/// بيفضلوا صح لأنهم بيتحسبوا في السيرفر.
bool _isSameDayLocal(DateTime? scheduledAt) {
  if (scheduledAt == null) return true; // بلا تاريخ = دلوقتي
  final now = DateTime.now();
  return scheduledAt.year == now.year && scheduledAt.month == now.month && scheduledAt.day == now.day;
}

/// تسجيل اهتمام العميل بخدمة (ADR-0046) — **fire-and-forget بالكامل**.
///
/// إشارة تسويقية بحتة: أي فشل فيها (مفيش شبكة، العميل مش مسجّل دخول، الـendpoint واقع) لازم
/// يتبلع تمامًا. تعطيل حجز حقيقي عشان إعلان ما اتسجّلش هيبقى مقايضة غبية.
void _recordServiceIntent(BuildContext context, String serviceId) {
  final auth = context.read<AuthRepository>();
  if (!auth.isAuthenticated) return; // زائر مش مسجّل — مفيش حساب نبعتله إشعار أصلاً
  unawaited(
    auth
        .authedRequest('POST', '/customer/service-intents', body: {
          'service_id': serviceId,
          'intent_stage': 'started_booking',
        })
        .catchError((_) => null),
  );
}
