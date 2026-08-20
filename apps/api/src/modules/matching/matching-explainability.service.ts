import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { BookingMode, Order } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import {
  classifyTechnicianCapacity,
  technicianAvailabilityCondition,
  TechnicianCapacityTier,
} from '../technicians/technician-eligibility.sql';

const FULL_DAY_JOB_MINUTES_FALLBACK = 360;

export interface TechnicianEligibilityCheck {
  key: string;
  passed: boolean;
  labelAr: string;
}

export interface TechnicianEligibilityExplanation {
  technicianId: string;
  orderId: string;
  eligible: boolean;
  /** أول سبب استبعاد حقيقي (أول check فاشل بترتيب findEligibleTechnicians())، أو نص "مؤهّل" لو eligible=true. */
  reasonAr: string;
  checks: TechnicianEligibilityCheck[];
  capacityTier: TechnicianCapacityTier | null;
  distanceKm: string | null;
}

interface EligibilityRow {
  verified: boolean;
  category_eligible: boolean;
  zone_eligible: boolean;
  has_location: boolean;
  not_already_offered: boolean;
  matches_requested_technician: boolean;
  matches_preferred_company: boolean;
  availability_ok: boolean;
  distance_km: string | null;
}

/**
 * تفسير مطابقة (docs/08 §35.7، ADR-0021 §4) — "ليه الفني ده مش بياخد الطلب ده؟" بإجابة بتستهلك
 * **نفس** الشروط الحقيقية اللي `MatchingService.findEligibleTechnicians()` بيفلتر بيها فعليًا
 * (نفس ترتيب WHERE clauses بالحرف)، صفر خوارزمية تشخيصية موازية مخترعة في الفرونت-إند — طلب
 * المالك صراحة ومكرر مرتين في §35 (تحذير من "لوحة أدمن بتخترع تفسير بديل"). كل check هنا بيتحسب
 * كعمود منفصل في استعلام واحد (مش N round-trips)، وبيتقيّموا **كلهم** (مش short-circuit) عشان
 * الأدمن يشوف الصورة الكاملة لو فيه أكتر من سبب استبعاد مع بعض.
 *
 * **إعادة استخدام حرفية**: `technicianAvailabilityCondition()` نفسها (نفس الدالة المستخدمة في
 * matching.service.ts/technicians.service.ts/technician-assignment-guard.service.ts) بتتلف هنا
 * جوّه `EXISTS` مترابط بدل ما تُستخدم كـWHERE مباشر — بيرجّع نفس النتيجة البوليانية بالظبط بلا أي
 * تكرار منطق. `classifyTechnicianCapacity()` كمان نفس الدالة المستخدمة في autoConfirmScheduledOrder().
 *
 * فحص "فئة/خدمة" (`category_eligible`) هو استثناء وحيد — SQL منسوخ حرفيًا (LEFT JOIN
 * technician_services + EXISTS technician_categories) من نفس الشرط في findEligibleTechnicians()،
 * مش دالة مشتركة مستخرجة (الشرط ده مكرر أصلاً بلا دالة مشتركة في matching.service.ts/
 * technicians.service.ts من قبل هذه الميزة — استخراجه لدالة مشتركة فعليًا يستدعي تعديل ملفين
 * شغالين ومُختبرين، خارج نطاق §35.7).
 */
@Injectable()
export class MatchingExplainabilityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  async explainTechnicianForOrder(order: Order, technicianId: string): Promise<TechnicianEligibilityExplanation> {
    if (!order.serviceZoneId) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مالوش نطاق خدمة محدد — مفيش مطابقة ممكنة عليه أصلاً', HttpStatus.BAD_REQUEST);
    }

    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);
    const isEmergency = order.bookingMode === BookingMode.EMERGENCY;

    const [row] = await this.dataSource.query<EligibilityRow[]>(
      `
      SELECT
        (tp.verification_status = 'approved') AS verified,
        (
          ts.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM technician_categories tc
            WHERE tc.technician_id = tp.id AND tc.category_id = s.category_id
              AND tc.is_active = true AND tc.verification_status = 'approved'
          )
        ) AS category_eligible,
        EXISTS (
          SELECT 1 FROM technician_zones tz WHERE tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
        ) AS zone_eligible,
        (tp.current_location IS NOT NULL) AS has_location,
        NOT EXISTS (
          SELECT 1 FROM order_assignments oa WHERE oa.order_id = $4 AND oa.technician_id = tp.id
        ) AS not_already_offered,
        ($7::uuid IS NULL OR tp.id = $7) AS matches_requested_technician,
        ($8::uuid IS NULL OR tp.company_id = $8) AS matches_preferred_company,
        EXISTS (
          SELECT 1 FROM technician_profiles tp2
          WHERE tp2.id = tp.id
          ${technicianAvailabilityCondition({
            technicianIdExpr: 'tp2.id',
            scheduledAtParam: '$9',
            excludeOrderIdParam: '$4',
            activeStatusesParam: '$6',
            engagedStatusesParam: '$10',
            isEmergencyParam: '$11',
            serviceDurationExpr: 'COALESCE(s.estimated_duration_minutes, 60)',
            fullDayThresholdMinutesParam: '$12',
          })}
        ) AS availability_ok,
        (ST_Distance(tp.current_location, a.location) / 1000.0)::text AS distance_km
      FROM technician_profiles tp
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN services s ON s.id = $1
      JOIN addresses a ON a.id = $3
      WHERE tp.id = $5 AND tp.deleted_at IS NULL
      `,
      [
        order.serviceId,
        order.serviceZoneId,
        order.addressId,
        order.id,
        technicianId,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        order.requestedTechnicianId,
        order.requestedTechnicianCompanyId,
        order.scheduledAt,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        isEmergency,
        fullDayJobMinutes,
      ],
    );

    if (!row) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }

    const checks: TechnicianEligibilityCheck[] = [
      { key: 'verified', passed: row.verified, labelAr: 'الفني معتمد (verification_status=approved)' },
      { key: 'category_eligible', passed: row.category_eligible, labelAr: 'مؤهّل لفئة/خدمة الطلب' },
      { key: 'zone_eligible', passed: row.zone_eligible, labelAr: 'مفعّل في نطاق خدمة الطلب' },
      { key: 'has_location', passed: row.has_location, labelAr: 'عنده موقع GPS مسجّل حاليًا' },
      { key: 'not_already_offered', passed: row.not_already_offered, labelAr: 'ماتعرضش عليه الطلب ده قبل كده' },
      { key: 'matches_requested_technician', passed: row.matches_requested_technician, labelAr: 'يطابق الفني المطلوب (إعادة حجز، لو مطلوب)' },
      { key: 'matches_preferred_company', passed: row.matches_preferred_company, labelAr: 'يطابق الشركة/الفريق المطلوب (اعتماد، لو مطلوب)' },
      { key: 'availability_ok', passed: row.availability_ok, labelAr: 'متاح وقت الطلب (بلا تعارض جدول/حظر يوم)' },
    ];

    const firstFailure = checks.find((c) => !c.passed);
    const eligible = !firstFailure;

    let capacityTier: TechnicianCapacityTier | null = null;
    try {
      const [service] = await this.dataSource.query<{ estimated_duration_minutes: number | null }[]>(
        `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
        [order.serviceId],
      );
      capacityTier = await classifyTechnicianCapacity(this.dataSource, {
        technicianId,
        scheduledAt: order.scheduledAt,
        excludeOrderId: order.id,
        serviceDurationMinutes: service?.estimated_duration_minutes ?? 60,
        fullDayThresholdMinutes: fullDayJobMinutes,
      });
    } catch {
      capacityTier = null;
    }

    const reasonAr = eligible ? 'مؤهّل بالكامل لمطابقة هذا الطلب دلوقتي' : `مش مؤهّل — ${firstFailure!.labelAr} (فشل)`;

    return {
      technicianId,
      orderId: order.id,
      eligible,
      reasonAr,
      checks,
      capacityTier,
      distanceKm: row.distance_km,
    };
  }
}
