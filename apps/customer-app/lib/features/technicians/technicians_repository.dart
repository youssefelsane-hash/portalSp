import 'dart:convert';

import '../../core/api_client.dart' as api_client;
import '../../core/auth_repository.dart';
import '../catalog/models.dart' show BookingMode, BookingModeJson;
import 'models.dart';

class TechniciansRepository {
  final AuthRepository auth;

  TechniciansRepository(this.auth);

  // اختيار الفني قبل الحجز (docs/08 §3) — @Public() في الباك-إند (GET /services/:id/technicians)،
  // بس محتاج address_id عشان يحسب المسافة/يفلتر على المنطقة. كانت فجوة موثّقة صراحة: الـendpoint
  // ده مختبر حي من سيشن سابقة بس مفيش أي شاشة في apps/customer-app بتناديه — العميل مكانش يقدر
  // يختار فني بنفسه قبل الحجز أصلاً، auto-match بس. اتقفلت (TechnicianSelectionScreen).
  Future<List<TechnicianBookingListItem>> listForService(
    String serviceId,
    String addressId, {
    String? excludeTechnicianId,
    // P0-10 (2026-08-13) — خدمات pricing_model=formula: لو JobDetailsScreen جمعت تفاصيل الشغل
    // قبل الوصول هنا، بنبعتها عشان final_price_cents يترجع حقيقي لكل فني (مش null) — راجع
    // apps/api/src/modules/catalog/dto/list-technicians-for-service.dto.ts (JSON مُرمّز في
    // query string، نفس نمط أي مرشّح كائن في REST APIs هنا).
    Map<String, dynamic>? fieldValues,
    // فرز يدوي (Script 6 Part 8) — recommended (افتراضي، ترتيب "الأنسب" من الباك-إند) أو
    // lowest_price/highest_rating. منفصل عمداً عن الترتيب الافتراضي، مش بديل له.
    String? sort,
    // "امتى تحب تنفّذ الشغل؟" (docs/08 §154، ADR-0017 بند 6) — null يعني ASAP، غير كده لازم
    // نتأكد إن الفني فعلاً يقدر ينفّذ في الموعد ده بالذات (مش عام "متاح دلوقتي" وبس). الباك-إند
    // بيستخدم نفس شرط الأهلية بالحرف اللي المطابقة الحقيقية بتستخدمه (technician-eligibility.sql.ts).
    DateTime? scheduledAt,
    // فلو "اعتماد" موحّد مع "فردي" (docs/08 §38) — لو team، الباك-إند بيفلتر مستوى الفني
    // (محترف فأعلى) وبيدمج الشركات في نفس القايمة. null/individual/emergency = صفر تغيير.
    BookingMode? bookingMode,
  }) async {
    // سياسة إلغاء الفني (docs/10) — excludeTechnicianId بيتبعت وقت اختيار فني بديل بعد ما فني
    // لغى، عشان نفس الفني مايظهرش تاني في القايمة.
    final query = StringBuffer();
    if (excludeTechnicianId != null) query.write('&exclude_technician_id=$excludeTechnicianId');
    if (fieldValues != null && fieldValues.isNotEmpty) {
      query.write('&field_values=${Uri.encodeComponent(jsonEncode(fieldValues))}');
    }
    if (sort != null) query.write('&sort=$sort');
    if (scheduledAt != null) query.write('&scheduled_at=${Uri.encodeComponent(scheduledAt.toUtc().toIso8601String())}');
    if (bookingMode != null) query.write('&booking_mode=${bookingMode.apiValue}');
    final items = await api_client.apiRequestList('/services/$serviceId/technicians?address_id=$addressId$query');
    return items.map(TechnicianBookingListItem.fromJson).toList();
  }

  Future<TechnicianPublicProfile> fetchPublicProfile(String technicianId) async {
    final data = await auth.authedRequest('GET', '/technicians/$technicianId/profile');
    return TechnicianPublicProfile.fromJson(data!);
  }

  // "اعتماد" (docs/06 §1.5) — الشركات/الفرق النشطة اللي العميل يقدر يحجزها كاملة.
  Future<List<TechnicianCompanySummary>> listActiveCompanies() async {
    final items = await auth.authedRequestList('/technician-companies');
    return items.map(TechnicianCompanySummary.fromJson).toList();
  }

  // الجدولة الحقيقية للفني (docs/08 §2-§3) — العميل يشوف السلوتات الفاضية/المحجوزة (أخضر/أحمر)
  // بتاعة فني بعينه ويختار واحد منها وقت الحجز. مش @Public() في الباك-إند (محتاج توكن عميل عادي).
  Future<List<ScheduleSlot>> fetchSchedule(String technicianId) async {
    final items = await auth.authedRequestList('/technicians/$technicianId/schedule');
    return items.map(ScheduleSlot.fromJson).toList();
  }

  /// **بنود 9-12 — بيحجز مرشّح بسعره قبل إنشاء الطلب.**
  ///
  /// قبل كده «خلي أسطى يختار لي» كان بينشئ الطلب الأول وبعدين السيستم يدوّر — العميل بيأكد وهو
  /// ماشافش مين ولا بكام. دلوقتي بيشوف الكارت الأول، والتذكرة اللي بترجع بتتبعت مع الإنشاء
  /// فالسعر اللي شافه هو اللي بيتسجّل.
  ///
  /// `fieldValues`/`scheduledAt`/`promoCode` لازم يبقوا **نفس اللي هيتبعت في الإنشاء بالحرف** —
  /// الباك-إند بيقارن بصمة المدخلات، وأي اختلاف معناه التذكرة بايتة والحجز بيترفض.
  /// بَقّة حقيقية اتلقطت باختبار حي (بلاغ مالك 2026-09-03، docs/08 §121-ب): الدالة دي كانت
  /// بتبعت 4 حقول بس، وشاشة التأكيد بتبعت للباك-إند إضافات وضمان وعدد وحدات وفترة — فالبصمة
  /// بتختلف والحجز بيترفض بـ«تفاصيل الحجز تغيّرت». أي حقل داخل في البصمة لازم يبقى ليه مكان
  /// هنا، وإلا نفس البَقّة بترجع بشكل تاني.
  Future<BookingMatchPreview> createMatchPreview({
    required String serviceId,
    required String addressId,
    required String selectionMode,
    String? technicianId,
    String? scheduledAt,
    String? scheduledEndAt,
    String? periodStart,
    String? periodEnd,
    Map<String, dynamic>? fieldValues,
    String? promoCode,
    String? buildingCode,
    List<String>? addonIds,
    String? warrantyPlanId,
    String? standardDataId,
    num? requestedUnits,
    num? pricingQuantity,
    num? durationHours,
  }) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/match-preview',
      body: {
        'service_id': serviceId,
        'address_id': addressId,
        'selection_mode': selectionMode,
        'technician_id': ?technicianId,
        'scheduled_at': ?scheduledAt,
        'scheduled_end_at': ?scheduledEndAt,
        'period_start': ?periodStart,
        'period_end': ?periodEnd,
        if (fieldValues != null && fieldValues.isNotEmpty) 'field_values': fieldValues,
        if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
        if (buildingCode != null && buildingCode.isNotEmpty) 'building_code': buildingCode,
        if (addonIds != null && addonIds.isNotEmpty) 'addon_ids': addonIds,
        'warranty_plan_id': ?warrantyPlanId,
        'standard_data_id': ?standardDataId,
        'requested_units': ?requestedUnits,
        'pricing_quantity': ?pricingQuantity,
        'duration_hours': ?durationHours,
      },
    );
    return BookingMatchPreview.fromJson(data!);
  }
}
