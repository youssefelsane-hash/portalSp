import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { BookingMode, Order } from '../orders/entities/order.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { TechnicianProfile, TechnicianVerificationStatus } from './entities/technician-profile.entity';
import { classifyTechnicianCapacity, technicianAvailabilityCondition, technicianServiceQualificationCondition } from './technician-eligibility.sql';

// نفس fallback matching.service.ts وtechnicians.service.ts — راجع ADR-0018 §2/§9.
const FULL_DAY_JOB_MINUTES_FALLBACK = 360;

/** Shared assignment eligibility used by technician acceptance and admin reassignment. */
@Injectable()
export class TechnicianAssignmentGuardService {
  constructor(private readonly settingsService: SettingsService) {}

  async lockTechnician(manager: EntityManager, technicianId: string): Promise<TechnicianProfile> {
    const technician = await manager
      .createQueryBuilder(TechnicianProfile, 'technician')
      .setLock('pessimistic_write')
      .where('technician.id = :technicianId', { technicianId })
      .getOne();
    if (!technician) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    return technician;
  }

  async assertEligible(manager: EntityManager, technician: TechnicianProfile, order: Order): Promise<void> {
    await this.assertCoreEligibility(manager, technician, order);

    await this.assertScheduleAvailable(manager, technician.id, order);
  }

  /**
   * فحص الجدول فقط، منفصل عن أهلية قيادة الطلب. الفصل ضروري لأن عضو الطاقم قد يكون مساعدًا
   * (لا يحق له قيادة الطلب) لكنه يظل محتاجًا لنفس حماية عدم تداخل المواعيد.
   */
  async isScheduleAvailable(manager: EntityManager, technicianId: string, order: Order): Promise<boolean> {
    // ADR-0017 بند 4-5 / ADR-0018 §9 — نفس مصدر التوافر المشترك مع matching.service.ts
    // (findEligibleTechnicians) وtechnicians.service.ts (listForServiceBooking)، بدل نسخة مستقلة
    // تالتة ممكن تنجرف عن الاتنين التانيين (زي ما حصل بالظبط قبل كده — راجع ADR-0017 السياق).
    // مكان الاستدعاء ده (قبول الفني الذاتي + تعيين الأدمن القسري) بيخدم كل أنواع الطلبات، فعكس
    // technicians.service.ts (تصفح العميل، طوارئ = false دايمًا) لازم نحسب isEmergency من نوع
    // الطلب الفعلي نفسه.
    const isEmergency = order.bookingMode === BookingMode.EMERGENCY;
    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);
    const [{ available }] = await manager.query<{ available: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM technician_profiles tp
         WHERE tp.id = $1
         -- $2 (serviceId) بقى غير مستخدم لما مدة المرشّح بقت تتقري من صف الطلب نفسه (o2) —
         -- tautology عشان Postgres يستنتج نوع الـparameter بدل "could not determine data type"
         AND ($2::uuid IS NULL OR $2::uuid IS NOT NULL)
         ${technicianAvailabilityCondition({
           technicianIdExpr: 'tp.id',
           scheduledAtParam: '$4',
           excludeOrderIdParam: '$3',
           activeStatusesParam: '$5',
           engagedStatusesParam: '$6',
           isEmergencyParam: '$7',
           serviceDurationExpr:
             'COALESCE((SELECT o2.duration_hours * 60 FROM orders o2 WHERE o2.id = $3::uuid), COALESCE((SELECT estimated_duration_minutes FROM services WHERE id = $2), 60), 60)',
           preciseDurationHoursExpr: '(SELECT o2.duration_hours FROM orders o2 WHERE o2.id = $3::uuid)',
           fullDayThresholdMinutesParam: '$8',
         })}
       ) AS available`,
      [
        technicianId,
        order.serviceId,
        order.id,
        order.scheduledAt,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        isEmergency,
        fullDayJobMinutes,
      ],
    );
    return available;
  }

  async assertScheduleAvailable(manager: EntityManager, technicianId: string, order: Order): Promise<void> {
    if (!(await this.isScheduleAvailable(manager, technicianId, order))) {
      throw new ApiException(ErrorCode.ORDR_003, 'الفني غير متاح في الوقت المطلوب لهذا الطلب (تعارض جدول أو طلب آخر نشط)', HttpStatus.CONFLICT);
    }
  }

  /**
   * إعادة فحص أهلية لقبول فرصة شغل إضافي اختيارية (docs/08 §34.1b، ADR-0020 §4) — **نفس فحوصات
   * `assertEligible()` الأساسية بالحرف (معتمد/موقع/خدمة+منطقة/مستوى)، لكن بدون بوابة `technician
   * AvailabilityCondition()` النهائية** (دي مصمّمة أصلاً لتستبعد أي تعارض يوم — `HEAVY`/`BLOCKED`
   * معًا — وده بالظبط عكس المطلوب هنا: الفني بيقبل فرصة **رغم** إنه `MEANINGFUL`/`HEAVY`، دي مش
   * غلطة، ده قرار الفني الصريح). البديل: فحص `classifyTechnicianCapacity()` بس — `BLOCKED`
   * (الفني حظر نفسه صراحة من وقت العرض لحد دلوقتي) هو الاستبعاد الوحيد المنطقي هنا.
   */
  async assertEligibleForWorkOpportunity(manager: EntityManager, technician: TechnicianProfile, order: Order): Promise<void> {
    await this.assertCoreEligibility(manager, technician, order);

    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);
    const [svc] = await manager.query<{ estimated_duration_minutes: number | null }[]>(`SELECT estimated_duration_minutes FROM services WHERE id = $1`, [
      order.serviceId,
    ]);
    // docs/01B — مدة المرشّح الحقيقية: duration_hours (ADR-0031/0032) بتتقدم على دقائق الخدمة الثابتة
    const tier = await classifyTechnicianCapacity(manager, {
      technicianId: technician.id,
      scheduledAt: order.scheduledAt,
      excludeOrderId: order.id,
      serviceDurationMinutes: order.durationHours != null && order.durationHours > 0 ? order.durationHours * 60 : (svc?.estimated_duration_minutes ?? 60),
      fullDayThresholdMinutes: fullDayJobMinutes,
    });
    if (tier === 'BLOCKED') {
      throw new ApiException(ErrorCode.ORDR_003, 'الفني حظر اليوم ده بنفسه — مينفعش يقبل الفرصة دي', HttpStatus.CONFLICT);
    }
  }

  private async assertCoreEligibility(manager: EntityManager, technician: TechnicianProfile, order: Order): Promise<void> {
    if (technician.verificationStatus !== TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.TECH_001, 'الفني ده لسه مش معتمد', HttpStatus.BAD_REQUEST);
    }
    // ADR-0055 (تصحيح مالك) — **الرفض على أساس الدور اتشال**. كان هنا حارس بيمنع تعيين أي مساعد
    // على طلب، وده اللي كان بيمنع التعيين الإداري القسري كمان. المالك صحّح الفهم: «المساعد» نوع
    // شغل مختلف (نقل/شيل) مش مستوى مهارة أقل، والشغل ده شغله هو بيعمله لوحده. ADR-0056 ثبّت إن
    // المساعد، مثل الفني، لازم يكون معتمدًا في التخصص؛ حجب الأدمن طبقة إضافية فوق الاعتماد.
    //
    // الأثر المالي طبيعي مش استثناء: المساعد اللي بيشيل طلب لوحده بياخد نصيب **القائد** الكامل
    // (`participant_role = 'leader'`)، وتسعيرة المساعد المخفّضة بتفضل مقصورة على انضمامه لطاقم
    // حد تاني (`participant_role = 'assistant'`). صفر تغيير في كود القسمة.
    // ADR-0017 بند 3 — is_available/is_on_duty اتشالوا من الأهلية بالكامل. الفني متاح افتراضيًا
    // (Opt-out) — مش محتاج يكون "أونلاين دلوقتي" عشان الأدمن يقدر يعيّنه لطلب مجدول (أو حتى فوري،
    // التعيين القسري قرار إداري صريح مش انتظار قبول عادي). التوافر الحقيقي بيتفحص تحت عبر
    // technicianAvailabilityCondition() (نفس المصدر المستخدم في matching.service.ts).
    if (!technician.currentLocation) {
      throw new ApiException(ErrorCode.ORDR_003, 'لا يوجد موقع حالي للفني يسمح بالتعيين', HttpStatus.CONFLICT);
    }

    const [capability] = await manager.query<
      {
        has_service: boolean;
        has_zone: boolean;
        level_configured: boolean;
        decision_limit_cents: number | null;
        eligible_for_team_booking: boolean;
      }[]
    >(
      `SELECT
         -- ADR-0018 §8 — خدمة معتمدة مباشرة أو فئة الخدمة معتمدة كلها (technician_categories) —
         -- نفس القاعدة المطبّقة في matching.service.ts وtechnicians.service.ts's
         -- listForServiceBooking() وassistant-matching.service.ts.
         (${technicianServiceQualificationCondition({
           technicianIdExpr: '$1',
           serviceIdExpr: '$2',
           categoryIdExpr: '(SELECT category_id FROM services WHERE id = $2)',
         })}) AS has_service,
         EXISTS (
           SELECT 1 FROM technician_zones
           WHERE technician_id = $1 AND service_zone_id = $3 AND is_active = true
         ) AS has_zone,
         EXISTS (
           SELECT 1 FROM technician_level_config WHERE level = $4
         ) AS level_configured,
         (SELECT decision_limit_cents FROM technician_level_config WHERE level = $4) AS decision_limit_cents,
         COALESCE((SELECT eligible_for_team_booking FROM technician_level_config WHERE level = $4), false)
           AS eligible_for_team_booking`,
      [technician.id, order.serviceId, order.serviceZoneId, technician.currentLevel],
    );
    if (!capability?.has_service || !capability.has_zone) {
      throw new ApiException(ErrorCode.ORDR_003, 'الفني غير مؤهل للخدمة أو نطاق الطلب', HttpStatus.CONFLICT);
    }
    if (!capability.level_configured) {
      throw new ApiException(ErrorCode.ORDR_003, 'مستوى الفني غير مهيأ للتعيين', HttpStatus.CONFLICT);
    }
    if (capability.decision_limit_cents !== null && order.totalAmountCents > Number(capability.decision_limit_cents)) {
      throw new ApiException(ErrorCode.ORDR_003, 'قيمة الطلب أعلى من حد قرار مستوى الفني', HttpStatus.CONFLICT);
    }
    // docs/08 §38 — بوابة نهائية (قبول ذاتي + تعيين قسري + تأكيد اختيار عميل صريح) تمنع أي تحايل
    // على فلترة listForServiceBooking()/findEligibleTechnicians() عن طريق نداء API مباشر.
    if (order.bookingMode === BookingMode.TEAM && !capability.eligible_for_team_booking) {
      throw new ApiException(ErrorCode.ORDR_003, 'مستوى الفني ده مش مؤهل يبقى قائد مهمة اعتماد', HttpStatus.CONFLICT);
    }
  }
}
