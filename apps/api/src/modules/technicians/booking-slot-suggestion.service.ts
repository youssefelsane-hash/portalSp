import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { GeoService } from '../geo/geo.service';
import { Address } from '../customers/entities/address.entity';
import {
  technicianAvailabilityCondition,
  technicianIndividualVisibilityCondition,
  technicianServiceQualificationCondition,
} from './technician-eligibility.sql';
import { resolveDailyCapacityMinutes } from './technician-day-capacity.sql';

/**
 * **اقتراح مواعيد للعميل** (ADR-0088، docs/08 §141).
 *
 * طلب المالك: «أول ما الكستمر يخش عشان يختار معاد، تقترح عليه إنت مواعيد… تشوف المواعيد اللي
 * عندنا فيها أكتر صنايع متاحين، المواعيد اللي فيها صنايع كتير فاضية ومفيش شغل لليوم ده».
 *
 * ### القاعدة الحاكمة: الاقتراح لازم يكون **قابل للحجز فعلاً**
 *
 * الشرط المستخدم هنا هو **نفس** `technicianServiceQualificationCondition()` +
 * `technicianAvailabilityCondition()` اللي بيحكموا قايمة اختيار الفني والتوزيع الحقيقي. أي
 * نسخة تانية «أسرع وأبسط» كانت هتنتج يوم مقترح يوصّل العميل لشاشة «مفيش فنيين متاحين» — وده
 * أسوأ من عدم وجود الاقتراح أصلاً، لأنه بيكسر الثقة في كل الاقتراحات بعد كده.
 *
 * ### ليه العدّ وليس مجرد EXISTS
 *
 * `hasEligibleTechnicianForDate()` الموجودة بتجاوب «فيه حد؟» (true/false). الترتيب المطلوب هنا
 * محتاج «فيه **كام**؟» عشان نقدر نفاضل بين يوم فيه فني واحد على وشك الامتلاء ويوم فيه عشرة
 * فاضيين. فالدالة دي بتعدّ، وبتعمل كل الأيام في استعلام واحد بـLATERAL بدل نداء لكل يوم.
 */

export interface SuggestedDay {
  /** تاريخ اليوم بصيغة YYYY-MM-DD بتوقيت مصر. */
  day: string;
  availableTechnicians: number;
  /** أول يوم مقترح بعد مهلة الحجز — «أقرب فرصة». */
  isEarliest: boolean;
}

export interface SuggestedTime {
  /** HH:MM بتوقيت مصر. */
  time: string;
  /** عدد الفنيين المؤهّلين اللي **مفيش عندهم أي شغل** متقاطع مع الساعة دي في اليوم ده. */
  freeTechnicians: number;
}

@Injectable()
export class BookingSlotSuggestionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly geoService: GeoService,
  ) {}

  private async config() {
    const [leadHours, horizonDays, count, dayStartHour, dayEndHour, roominessRatio] = await Promise.all([
      this.settingsService.getNumber('booking.suggestion_lead_hours', 48),
      this.settingsService.getNumber('booking.suggestion_horizon_days', 21),
      this.settingsService.getNumber('booking.suggestion_count', 3),
      this.settingsService.getNumber('booking.suggestion_day_start_hour', 9),
      this.settingsService.getNumber('booking.suggestion_day_end_hour', 19),
      this.settingsService.getNumber('booking.suggestion_roominess_ratio', 0.7),
    ]);
    return { leadHours, horizonDays, count, dayStartHour, dayEndHour, roominessRatio };
  }

  /**
   * النطاق بيتحسب من **العنوان** — مش بارامتر من العميل. لو الواجهة بعتت معرّف نطاق بإيدها كان
   * ممكن تقرا طاقة منطقة تانية مش بتاعتها.
   *
   * الحساب بيمرّ على `GeoService.findZoneForPoint()` — **نفس** الدالة اللي إنشاء الطلب بيستخدمها
   * (`order-creation.service.ts`). أي استعلام نطاق مكتوب هنا من أول وجديد كان هيبقى مصدر حقيقة
   * تاني يقدر ينحرف، فيقترح يوم بناءً على نطاق غير اللي الطلب هيتحسب عليه فعلاً.
   */
  private async resolveZone(customerUserId: string, addressId: string): Promise<string> {
    const address = await this.dataSource.getRepository(Address).findOne({
      where: { id: addressId, userId: customerUserId },
    });
    if (!address) throw new ApiException(ErrorCode.VAL_001, 'العنوان غير موجود', HttpStatus.NOT_FOUND);
    if (!address.cityId || !address.location) {
      throw new ApiException(ErrorCode.VAL_001, 'العنوان مش مربوط بمدينة أو موقع', HttpStatus.BAD_REQUEST);
    }
    const [longitude, latitude] = address.location.coordinates;
    const zone = await this.geoService.findZoneForPoint(address.cityId, latitude, longitude);
    if (!zone) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }
    return zone.id;
  }

  /**
   * أيام مقترحة، مرتّبة بالأقرب **من بين الأيام اللي فيها براح حقيقي**.
   *
   * ترتيب بالعدد لوحده كان هيقترح يوم بعد أسبوعين لأنه أفضل بفني واحد — وده عكس طلب المالك
   * («ما يبقاش يوم بعيد أوي… تختار أول الأيام اللي فيها براح»). فالترتيب على مرحلتين:
   *  1. نحدد أحسن طاقة موجودة في الأفق كله.
   *  2. أي يوم طاقته ≥ النسبة (`suggestion_roominess_ratio`) × الأحسن بيتعد «فيه براح»، و**بناخد
   *     الأقرب منهم زمنيًا** — مش الأعلى عددًا.
   */
  async suggestDays(opts: {
    customerUserId: string;
    serviceId: string;
    addressId: string;
    durationMinutes?: number | null;
    estimatedDurationDays?: number | null;
  }): Promise<{ days: SuggestedDay[]; leadHours: number; horizonDays: number }> {
    const zoneId = await this.resolveZone(opts.customerUserId, opts.addressId);
    const cfg = await this.config();
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);

    const rows = await this.dataSource.query<{ day: string; available_technicians: string }[]>(
      `
      WITH bounds AS (
        SELECT ((now() AT TIME ZONE 'Africa/Cairo') + make_interval(hours => $4::int))::date AS first_day
      ),
      days AS (
        SELECT gs::date AS day,
               (gs::date::timestamp AT TIME ZONE 'Africa/Cairo') AS day_start
          FROM bounds b,
               generate_series(b.first_day, b.first_day + make_interval(days => $5::int), interval '1 day') gs
      )
      SELECT d.day::text AS day, c.cnt::text AS available_technicians
        FROM days d
        CROSS JOIN LATERAL (
          SELECT COUNT(*) AS cnt
            FROM technician_profiles tp
            LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1
              AND ts.is_active = true AND ts.verification_status = 'approved'
            JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
            JOIN services svc ON svc.id = $1
           WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
             AND tp.current_location IS NOT NULL
             AND ${technicianServiceQualificationCondition({
               technicianIdExpr: 'tp.id',
               serviceIdExpr: 'svc.id',
               categoryIdExpr: 'svc.category_id',
               directServiceAlias: 'ts',
             })}
             -- ADR-0080 — الاقتراح سؤال عن الطاقة المتاحة للأفراد، فالحصري للشركة مايتحسبش.
             AND ${technicianIndividualVisibilityCondition({ technicianAlias: 'tp' })}
             ${technicianAvailabilityCondition({
               technicianIdExpr: 'tp.id',
               // اليوم المرشّح بيتحقن كتعبير من الـLATERAL بدل parameter ثابت — ده اللي بيخلّي
               // الأفق كله استعلام واحد بدل نداء لكل يوم.
               scheduledAtParam: 'd.day_start',
               excludeOrderIdParam: '$9',
               activeStatusesParam: '$6',
               engagedStatusesParam: '$7',
               isEmergencyParam: '$8',
               serviceDurationExpr: 'COALESCE($10::int, COALESCE(svc.estimated_duration_minutes, 60))',
               candidateLoad: {
                 estimatedDurationDaysExpr: '$11::numeric',
                 durationMinutesExpr: '$10::int',
                 serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
               },
               preciseDurationHoursExpr: '$10::numeric / 60.0',
               dailyCapacityMinutesParam: '$3',
             })}
        ) c
       ORDER BY d.day
      `,
      [
        opts.serviceId,
        zoneId,
        dailyCapacityMinutes,
        Math.max(0, Math.round(cfg.leadHours)),
        Math.max(1, Math.round(cfg.horizonDays)),
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        null,
        opts.durationMinutes ?? null,
        opts.estimatedDurationDays ?? null,
      ],
    );

    const withCapacity = rows
      .map((row) => ({ day: row.day, availableTechnicians: Number(row.available_technicians) }))
      .filter((row) => row.availableTechnicians > 0);

    if (withCapacity.length === 0) {
      return { days: [], leadHours: cfg.leadHours, horizonDays: cfg.horizonDays };
    }

    const best = Math.max(...withCapacity.map((row) => row.availableTechnicians));
    const threshold = Math.max(1, Math.ceil(best * cfg.roominessRatio));
    let roomy = withCapacity.filter((row) => row.availableTechnicians >= threshold);
    // لو التصفية بالبراح طلّعت أقل من المطلوب، بنكمّل بالأقرب زمنيًا من الباقي بدل ما نرجّع
    // اقتراح ناقص — يوم فيه فني واحد متاح لسه أحسن من خانة فاضية.
    if (roomy.length < cfg.count) {
      const rest = withCapacity.filter((row) => !roomy.includes(row));
      roomy = [...roomy, ...rest].sort((left, right) => left.day.localeCompare(right.day));
    }

    const days = roomy
      .sort((left, right) => left.day.localeCompare(right.day))
      .slice(0, Math.max(1, Math.round(cfg.count)))
      .map((row, index) => ({ ...row, isEarliest: index === 0 }));

    return { days, leadHours: cfg.leadHours, horizonDays: cfg.horizonDays };
  }

  /**
   * ساعات مقترحة داخل يوم مختار — «الساعات اللي مفيهاش شغل».
   *
   * الفرق عن اقتراح اليوم: هنا الفني اللي عنده شغل **متقاطع مع الساعة دي بالذات** بيتشال، حتى
   * لو يومه لسه تحت السقف. العميل اللي بيختار ساعة عايز حد يقدر ييجي **الساعة دي**، مش حد يومه
   * فيه فسحة في مكان ما.
   */
  async suggestTimes(opts: {
    customerUserId: string;
    serviceId: string;
    addressId: string;
    day: string;
    durationMinutes?: number | null;
  }): Promise<{ times: SuggestedTime[] }> {
    const zoneId = await this.resolveZone(opts.customerUserId, opts.addressId);
    const cfg = await this.config();

    const rows = await this.dataSource.query<{ hour: string; free_technicians: string }[]>(
      `
      WITH hours AS (
        SELECT gs AS hour_of_day,
               (($3::text || ' ' || lpad(gs::text, 2, '0') || ':00')::timestamp AT TIME ZONE 'Africa/Cairo') AS slot_start
          FROM generate_series($4::int, $5::int) gs
      ),
      eligible AS (
        SELECT tp.id
          FROM technician_profiles tp
          LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1
            AND ts.is_active = true AND ts.verification_status = 'approved'
          JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
          JOIN services svc ON svc.id = $1
         WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
           AND tp.current_location IS NOT NULL
           AND ${technicianServiceQualificationCondition({
             technicianIdExpr: 'tp.id',
             serviceIdExpr: 'svc.id',
             categoryIdExpr: 'svc.category_id',
             directServiceAlias: 'ts',
           })}
           AND ${technicianIndividualVisibilityCondition({ technicianAlias: 'tp' })}
      )
      SELECT lpad(h.hour_of_day::text, 2, '0') || ':00' AS hour,
             COUNT(*) FILTER (WHERE NOT busy.is_busy)::text AS free_technicians
        FROM hours h
        CROSS JOIN eligible e
        CROSS JOIN LATERAL (
          SELECT EXISTS (
            -- الالتزام بيتقرا من القيادة **ومن عضوية الطاقم** مع بعض. الاكتفاء بـtechnician_id
            -- كان بيخلّي المساعد اللي مضاف لطاقم طلب تاني يبان فاضي (نفس جذر بَقّة ADR-0057).
            SELECT 1 FROM orders o
             WHERE o.deleted_at IS NULL
               AND o.order_status = ANY($6::order_status[])
               AND (o.technician_id = e.id
                 OR EXISTS (SELECT 1 FROM order_team_members m WHERE m.order_id = o.id AND m.technician_id = e.id))
               AND o.scheduled_at IS NOT NULL
               AND tstzrange(
                     o.scheduled_at,
                     o.scheduled_at + make_interval(mins =>
                       GREATEST(COALESCE(o.duration_minutes, (o.duration_hours * 60)::int,
                                (SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = o.service_id)), 30)),
                     '[)')
                   && tstzrange(h.slot_start, h.slot_start + make_interval(mins => $7::int), '[)')
          )
          OR EXISTS (
            SELECT 1 FROM technician_schedule_slots tss
             WHERE tss.technician_id = e.id AND tss.deleted_at IS NULL
               AND tss.status = 'blocked'
               AND tsrange(tss.slot_date + tss.start_time, tss.slot_date + tss.end_time, '[)')
                   && tsrange(
                        (h.slot_start AT TIME ZONE 'Africa/Cairo'),
                        (h.slot_start AT TIME ZONE 'Africa/Cairo') + make_interval(mins => $7::int),
                        '[)')
          ) AS is_busy
        ) busy
       GROUP BY h.hour_of_day
       ORDER BY COUNT(*) FILTER (WHERE NOT busy.is_busy) DESC, h.hour_of_day ASC
      `,
      [
        opts.serviceId,
        zoneId,
        opts.day,
        Math.max(0, Math.round(cfg.dayStartHour)),
        Math.min(23, Math.round(cfg.dayEndHour)),
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        Math.max(30, Math.round(opts.durationMinutes ?? 60)),
      ],
    );

    const times = rows
      .map((row) => ({ time: row.hour, freeTechnicians: Number(row.free_technicians) }))
      .filter((row) => row.freeTechnicians > 0)
      .slice(0, Math.max(1, Math.round(cfg.count)))
      // العرض بترتيب الساعة عشان القايمة تتقرا طبيعي، بعد ما الاختيار اتعمل بالأكثر فراغًا.
      .sort((left, right) => left.time.localeCompare(right.time));

    return { times };
  }
}
