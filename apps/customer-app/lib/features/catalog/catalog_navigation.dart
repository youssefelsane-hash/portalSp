import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_gate.dart';
import '../../core/auth_repository.dart';
import '../../core/funnel_tracker.dart';
import '../addresses/addresses_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../orders/assessment_route.dart';
import '../orders/create_order_screen.dart';
import '../orders/job_details_screen.dart';
import '../orders/schedule_selection_screen.dart';
import '../technicians/technician_selection_screen.dart';
import 'catalog_repository.dart';
import 'models.dart';

// Script 3 §6/§59 — نقطة تنقّل واحدة لكل مسارات اكتشاف الخدمة (فئات، بحث، لاحقًا: صوت/صورة) —
// "All paths must converge into the SAME booking architecture. Do NOT build six booking engines."
// كانت الشجرة دي مكررة داخل ServicesScreen بس؛ اتفصلت هنا عشان HomeScreen/SearchResultsScreen
// يستخدموها بنفس السلوك بالظبط بلا تكرار.
//
// **وضع الحجز مابقاش بيتسأل خالص (ADR-0048)** — بيتشتق في الباك-إند من اليوم المختار وعدد
// العمال المطلوب. الخطوة الوحيدة اللي العميل بيشوفها بعد اختيار الخدمة هي **الميعاد**.
Future<void> navigateToServiceBooking(
  BuildContext context,
  CatalogService service,
) async {
  final availableModes = service.availableBookingModes;
  // مفيش وضع حجز مسموح للخدمة دي أصلاً — حالة بيانات غير متوقعة، تجاهل بأمان
  if (availableModes.isEmpty) {
    return;
  }
  // ملاحظة: `availableBookingModes` بقت تُستخدم هنا كفحص "الخدمة قابلة للحجز أصلاً" بس — مش
  // كقايمة اختيارات تتعرض للعميل (ADR-0048).

  // **«شاف الخدمة» بيتسجّل هنا بالظبط، قبل بوابة تسجيل الدخول** (بلاغ مالك 2026-09-09: أول
  // خانتين في الفنل دايمًا صفر).
  //
  // كان بيتسجّل في `CreateOrderScreen.initState` — و`CreateOrderScreen` هي **آخر** شاشة في
  // الرحلة، بعد الميعاد واختيار الفني ومعاينة السعر. النتيجة إن المرحلة اللي المفروض تقيس
  // «كام حد فتح خدمة» ماكانتش بتتسجّل إلا للناس اللي وصلوا للآخر خالص — يعني اللي وقعوا في
  // النص (وهم بالظبط اللي الفنل موجود عشانهم) ماكانوش بيتعدّوا خالص، والخانة تفضل صفر.
  //
  // والدالة دي هي **نقطة الالتقاء الوحيدة** لكل مسارات اكتشاف الخدمة (فئات/بحث/الرئيسية)،
  // فتسجيلها هنا معناه إنها مستحيل تتفوّت في مسار جديد يتضاف بعدين.
  FunnelTracker.instance.track('service_viewed', serviceId: service.id);

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
    reason:
        'عشان نحجزلك «${service.nameAr}» محتاجين نعرف عنوانك ونقدر نتواصل معاك.',
    headline: 'كمّل حجز «${service.nameAr}»',
  );
  if (!signedIn || !context.mounted) return;

  // ADR-0046 — إشارة "العميل بدأ حجز الخدمة دي". لو ما كمّلش، الاسترجاع بيفكّره بعد ساعة.
  // النقطة دي بالذات لأنها مكان التقاء **كل** مسارات اكتشاف الخدمة (فئات/بحث/الرئيسية).
  _recordServiceIntent(context, service.id);

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // **ترتيب الرحلة بقى بتبعية البيانات، مش بالعادة** (طلب مالك 2026-09-16، docs/08 §155، ADR-0100)
  //
  //   خدمة → عنوان → تفاصيل الشغل → المدة → الميعاد الذكي → المنفّذ → التأكيد
  //
  // كل خطوة محتاجة ناتج اللي قبلها بالظبط. الميعاد اتأخّر عن المدة لأنه **مالوش معنى** من
  // غيرها: اقتراح المواعيد بيشتق «مدى الشغل» من المدة، ومن غير مدة المدى بيطلع **يوم واحد** —
  // فشغل ٥ أيام كان بيتقاس على يوم بدايته وبس، والمطابقة بترفض بعدين اليوم اللي إحنا وعدنا بيه.
  // ═══════════════════════════════════════════════════════════════════════════════════════

  // ── خطوة ١: العنوان الحقيقي للطلب ده ──
  //
  // **مش العنوان الافتراضي.** قبل كده العميل اللي عنده عنوانين كان الاقتراح بيتحسب على نطاق
  // عنوانه الافتراضي، وبعدين يختار عنوان تاني للطلب — فالطلب يتعمل في نطاق طاقته مختلفة تمامًا
  // عن اللي الاقتراح وعد بيه، بلا أي كود بيربط الاتنين (docs/08 §155 بند ٢).
  //
  // **ومش خطوة زيادة**: العميل كان بيتسأل على العنوان بعد الميعاد على أي حال
  // (`JobDetailsScreen`/`TechnicianSelectionScreen`). نفس الخطوة، اتقدّمت لمكانها الصح، والعنوان
  // بيتمرر لكل الشاشات بعدها فمابيتسألش عليه تاني.
  final Address? address = await _selectOrderAddress(context);
  if (address == null || !context.mounted) return;

  // ── خطوة ٢: تفاصيل الشغل المؤثّرة في التنفيذ ──
  //
  // **بس اللي بيغيّر التنفيذ فعلاً** — نفس القاعدة الحاكمة لبصمة `booking-match-context.ts`
  // بالحرف: الحقل يتقدّم لو بيغيّر المدة أو الطاقم أو المهارات أو نوع المنفّذ أو الطاقة.
  //
  // عمليًا دي حقول التسعير الديناميكي لخدمات `formula` — هي مدخلات `CatalogService.estimate()`
  // اللي بتطلّع `duration_minutes`/`estimated_duration_days`. الخدمات التانية مدتها ثابتة من
  // الكتالوج (`estimated_duration_minutes`)، فمفيش حاجة تتجمع قبل الميعاد — وملاحظات العميل
  // وتعليمات الوصول **مابتتحركش** من مكانها في `CreateOrderScreen` لأنها مالهاش أي أثر تشغيلي.
  Map<String, dynamic>? fieldValues;
  Address effectiveAddress = address;
  if (service.pricingModel == 'formula') {
    final details = await Navigator.of(context).push<JobDetailsResult>(
      MaterialPageRoute(
        builder: (_) => JobDetailsScreen(
          service: service,
          bookingMode: availableModes.contains(BookingMode.individual)
              ? BookingMode.individual
              : availableModes.first,
          initialAddress: address,
        ),
      ),
    );
    if (details == null || !context.mounted) return;
    fieldValues = details.fieldValues;
    // العميل يقدر يغيّر العنوان من جوّه الشاشة — والتغيير ده لازم يسري على الاقتراح والتسعير
    // بعده، مش يتجاهل.
    effectiveAddress = details.address;
  }

  // ── خطوة ٣: المدة الحقيقية، من محرك التسعير ──
  //
  // **مش محسوبة هنا.** بتتقرا من `POST /services/:id/estimate` — نفس `CatalogService.estimate()`
  // اللي إنشاء الطلب وقايمة الفنيين بيستخدموها. أي حسبة مدة في التطبيق كانت هتبقى مصدر حقيقة
  // تانٍ يقدر ينحرف، فيقترح يوم المطابقة ترفضه (نفس حجّة ADR-0088/0096 بالحرف).
  //
  // الفشل بيرجّع `null` والاقتراح بيرجع لسلوكه القديم — تدهور، مش توقف.
  final jobLoad = await CatalogRepository().estimateJobLoad(
    service.id,
    fieldValues: fieldValues,
  );
  if (!context.mounted) return;

  // ── خطوة ٤: الميعاد، وهو دلوقتي عارف الشغل كله ──
  //
  // **سؤال «إزاي حابب تحجز الخدمة دي؟» اتشال نهائيًا (ADR-0048، طلب مالك صريح، docs/08 §85)**:
  // «بدل ما أسأل الكاستمر عايز شغلنا طوارئ ولا فوري ولا فردي، نشيل دول خالص ونحط قواعد على
  // السيستم، والسيستم هو اللي بيحدد بناءً على التاريخ».
  //
  // الوضع (طوارئ/فريق/فردي) بيتحسب في الباك-إند من اليوم المختار وعدد العمال، والعميل مابيشوفش
  // المصطلحات دي خالص.
  final choice = await Navigator.of(context).push<ScheduleChoice>(
    MaterialPageRoute(
      builder: (_) => ScheduleSelectionScreen(
        allowsDateRangeBooking: service.allowsDateRangeBooking,
        serviceName: service.nameAr,
        warrantyDays: service.warrantyDays,
        requiresPreciseTime: service.requiresStartTime,
        allowsSameDay: service.allowsEmergency,
        serviceId: service.id,
        // العنوان الحقيقي والمدة الحقيقية — الاتنين معروفين دلوقتي، ومن غيرهم الاقتراح كان
        // بيتحسب على نطاق مفترض ومدة مفترضة (ADR-0100).
        addressId: effectiveAddress.id,
        durationMinutes: jobLoad?.durationMinutes,
        estimatedDurationDays: jobLoad?.estimatedDurationDays,
      ),
    ),
  );
  // العميل رجع من غير ما يختار — نلغي الحجز كله
  if (choice == null || !context.mounted) {
    return;
  }
  // **«بدأ الحجز» = العميل اختار ميعاد فعلاً** — أول التزام حقيقي منه في الرحلة. المرحلتين
  // كانوا بيتسجّلوا في نفس السطر بنفس اللحظة، فالخانتين كانوا بيطلعوا نفس الرقم دايمًا
  // والتسرّب بينهم صفر بالتعريف — قياس مالوش أي معنى.
  FunnelTracker.instance.track('booking_started', serviceId: service.id);

  final DateTime scheduledAt = choice.scheduledAt;
  final DateTime? scheduledAtRangeEnd = choice.rangeEnd;
  final TimeOfDay? preciseTime = choice.preciseTime;

  // الوضع المحلي ده **للتنقّل بس** — الباك-إند بيعيد اشتقاقه من جديد بتوقيت القاهرة وهو المرجع
  // الوحيد (ADR-0048 §1). اليوم المختار هو النهارده ⇒ خدمة مستعجلة ⇒ مفيش خطوة اختيار فني
  // (أول فني يقبل هو اللي بيروح)، بالظبط زي ما الطوارئ كانت بتشتغل قبل كده.
  final BookingMode bookingMode = _isSameDayLocal(scheduledAt)
      ? BookingMode.emergency
      : (availableModes.contains(BookingMode.individual)
            ? BookingMode.individual
            : availableModes.first);

  if (!context.mounted) return;
  Navigator.of(context).push(
    MaterialPageRoute(
      // فلو "اعتماد" موحّد مع "فردي" بالحرف (docs/08 §36+§38، طلب مالك صريح 2026-08-21 — اتصلحت
      // بشكل مستقل في سيشنين متوازيين بنفس الفرع بالظبط) — الفرق الوحيد بينهم بقى فلترة مستوى
      // الفني + دمج الشركات جوّه TechnicianMarketplaceScreen نفسها (booking_mode بيتمرر لحد هناك)،
      // مش مسار تنقّل مختلف. الطوارئ بس (حجز فوري بالتصميم، مفيش اختيار يدوي خالص) بتروح
      // CreateOrderScreen مباشرة زي ما كانت دايمًا.
      // **فرع `formula` اتشال من هنا** (ADR-0100): تفاصيل الشغل بقت خطوة ٢ فوق، قبل الميعاد.
      // اللي فضل هو الفرق الحقيقي الوحيد: فيه اختيار منفّذ ولا مفيش.
      builder: (_) => bookingMode == BookingMode.emergency
          ? CreateOrderScreen(
              service: service,
              bookingMode: bookingMode,
              requestedAt: scheduledAt,
              requestedAtRangeEnd: scheduledAtRangeEnd,
              requestedPreciseTime: preciseTime,
              initialAddress: effectiveAddress,
              initialFieldValues: fieldValues,
            )
          // **خدمة مسارها الوحيد هو التقييم بالصور مابتعديش على اختيار فني** (docs/08 §131):
          // في المسار ده الإدارة بتحدد السعر من الصور، العميل يوافق، **وبعدين** التوزيع
          // بيبدأ — يعني مفيش منفّذ متحدد وقت الحجز أصلاً. الشاشة كانت بتتعرض برضه، فالعميل
          // يختار فني وتتعمل تذكرة سعر، وبعدين يترفض عند التأكيد بـ«معاينة الفني لا تُجمع مع
          // تقييم الصور» بلا أي طريقة يرجع منها. خدمة عندها المسارين لسه بتعدّي عادي — هناك
          // اختيار الفني له معنى للمعاينة في الموقع.
          : !AssessmentRoutes.forService(service).onsite &&
                AssessmentRoutes.forService(service).remote
          ? CreateOrderScreen(
              service: service,
              bookingMode: bookingMode,
              requestedAt: scheduledAt,
              requestedAtRangeEnd: scheduledAtRangeEnd,
              requestedPreciseTime: preciseTime,
              initialAddress: effectiveAddress,
              initialFieldValues: fieldValues,
            )
          : TechnicianSelectionScreen(
              service: service,
              bookingMode: bookingMode,
              requestedAt: scheduledAt,
              requestedAtRangeEnd: scheduledAtRangeEnd,
              requestedPreciseTime: preciseTime,
              initialAddress: effectiveAddress,
              fieldValues: fieldValues,
            ),
    ),
  );
}

/// **عنوان الطلب ده بالتحديد** (ADR-0100 — بيوسّع ADR-0098 من العميل الجديد لكل العملاء).
///
/// بترجّع العنوان اللي العميل اختاره فعلاً، أو `null` لو رجع من غير اختيار (ساعتها الحجز بيتلغي
/// بهدوء — مفيش أي خطوة بعد كده ليها معنى بلا عنوان: لا مدة، ولا اقتراح، ولا سعر).
///
/// **ليه بقت دايمًا، وليه دي مش خطوة زيادة**: ADR-0098 كانت بتسأل العميل الجديد بس، واللي عنده
/// عنوان محفوظ كان الاقتراح بيتحسب له على **العنوان الافتراضي** — وبعدين يتسأل على عنوان الطلب
/// الحقيقي في `JobDetailsScreen`/`TechnicianSelectionScreen`. يعني السؤال كان بيتسأل على أي حال،
/// بس **بعد** ما الاقتراح اتبنى على عنوان تاني. اللي اتغيّر هو مكان السؤال، مش عددها.
///
/// العميل اللي عنده عنوان واحد بياخد ضغطة واحدة على قايمة جاهزة. واللي عنده أكتر بيختار — وده
/// بالظبط اللي كان ناقص.
Future<Address?> _selectOrderAddress(BuildContext context) async {
  // نداء استطلاعي بحت: لو العميل مالوش ولا عنوان، `AddressesScreen` بتفتح على فورم الإضافة
  // مباشرةً. فشله مايمنعش أي حاجة — الشاشة بتتفتح في الحالتين.
  try {
    await AddressesRepository(context.read<AuthRepository>()).list();
  } catch (_) {
    // مفيش أي قرار متعلّق بالنتيجة — بنكمّل للشاشة على أي حال.
  }
  if (!context.mounted) return null;
  return Navigator.of(context).push<Address>(
    MaterialPageRoute(
      builder: (_) => const AddressesScreen(selectionMode: true),
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
  return scheduledAt.year == now.year &&
      scheduledAt.month == now.month &&
      scheduledAt.day == now.day;
}

/// تسجيل اهتمام العميل بخدمة (ADR-0046) — **fire-and-forget بالكامل**.
///
/// إشارة تسويقية بحتة: أي فشل فيها (مفيش شبكة، العميل مش مسجّل دخول، الـendpoint واقع) لازم
/// يتبلع تمامًا. تعطيل حجز حقيقي عشان إعلان ما اتسجّلش هيبقى مقايضة غبية.
void _recordServiceIntent(BuildContext context, String serviceId) {
  final auth = context.read<AuthRepository>();
  // زائر مش مسجّل — مفيش حساب نبعتله إشعار أصلاً
  if (!auth.isAuthenticated) {
    return;
  }
  unawaited(
    auth
        .authedRequest(
          'POST',
          '/customer/service-intents',
          body: {'service_id': serviceId, 'intent_stage': 'started_booking'},
        )
        .catchError((_) => null),
  );
}
