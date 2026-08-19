import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { BookingMode, Order } from '../orders/entities/order.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { TechnicianProfile, TechnicianVerificationStatus } from './entities/technician-profile.entity';
import { technicianAvailabilityCondition } from './technician-eligibility.sql';

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
    if (technician.verificationStatus !== TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.TECH_001, 'الفني ده لسه مش معتمد', HttpStatus.BAD_REQUEST);
    }
    // ADR-0017 بند 3 — is_available/is_on_duty اتشالوا من الأهلية بالكامل. الفني متاح افتراضيًا
    // (Opt-out) — مش محتاج يكون "أونلاين دلوقتي" عشان الأدمن يقدر يعيّنه لطلب مجدول (أو حتى فوري،
    // التعيين القسري قرار إداري صريح مش انتظار قبول عادي). التوافر الحقيقي بيتفحص تحت عبر
    // technicianAvailabilityCondition() (نفس المصدر المستخدم في matching.service.ts).
    if (!technician.currentLocation) {
      throw new ApiException(ErrorCode.ORDR_003, 'لا يوجد موقع حالي للفني يسمح بالتعيين', HttpStatus.CONFLICT);
    }

    const [capability] = await manager.query<
      { has_service: boolean; has_zone: boolean; level_configured: boolean; decision_limit_cents: number | null }[]
    >(
      `SELECT
         EXISTS (
           SELECT 1 FROM technician_services
           WHERE technician_id = $1 AND service_id = $2 AND is_active = true
             AND verification_status = 'approved'
         ) AS has_service,
         EXISTS (
           SELECT 1 FROM technician_zones
           WHERE technician_id = $1 AND service_zone_id = $3 AND is_active = true
         ) AS has_zone,
         EXISTS (
           SELECT 1 FROM technician_level_config WHERE level = $4
         ) AS level_configured,
         (SELECT decision_limit_cents FROM technician_level_config WHERE level = $4) AS decision_limit_cents`,
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

    // ADR-0017 بند 4-5 / ADR-0018 §9 — نفس مصدر التوافر المشترك مع matching.service.ts
    // (findEligibleTechnicians) وtechnicians.service.ts (listForServiceBooking)، بدل نسخة مستقلة
    // تالتة ممكن تنجرف عن الاتنين التانيين (زي ما حصل بالظبط قبل كده — راجع ADR-0017 السياق).
    // مكان الاستدعاء ده (قبول الفني الذاتي + تعيين الأدمن القسري) بيخدم كل أنواع الطلبات، فعكس
    // technicians.service.ts (تصفح العميل، طوارئ = false دايمًا) لازم نحسب isEmergency من نوع
    // الطلب الفعلي نفسه.
    const isEmergency = order.bookingMode === BookingMode.EMERGENCY;
    const fullDayJobMinutes = await this.settingsService.getNumber(
      'matching.full_day_job_minutes',
      FULL_DAY_JOB_MINUTES_FALLBACK,
    );
    const [{ available }] = await manager.query<{ available: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM technician_profiles tp
         WHERE tp.id = $1
         ${technicianAvailabilityCondition({
           technicianIdExpr: 'tp.id',
           scheduledAtParam: '$4',
           excludeOrderIdParam: '$3',
           activeStatusesParam: '$5',
           engagedStatusesParam: '$6',
           isEmergencyParam: '$7',
           serviceDurationExpr: '(SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $2)',
           fullDayThresholdMinutesParam: '$8',
         })}
       ) AS available`,
      [
        technician.id,
        order.serviceId,
        order.id,
        order.scheduledAt,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        isEmergency,
        fullDayJobMinutes,
      ],
    );
    if (!available) {
      throw new ApiException(ErrorCode.ORDR_003, 'الفني غير متاح في الوقت المطلوب لهذا الطلب (تعارض جدول أو طلب آخر نشط)', HttpStatus.CONFLICT);
    }
  }
}
