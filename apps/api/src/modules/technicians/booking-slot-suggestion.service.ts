import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { GeoService } from '../geo/geo.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { Address } from '../customers/entities/address.entity';
import {
  technicianAvailabilityCondition,
  technicianIndividualVisibilityCondition,
  technicianServiceQualificationCondition,
} from './technician-eligibility.sql';
import { resolveDailyCapacityMinutes, technicianDayLoadSubquery } from './technician-day-capacity.sql';
import { BookingWindow, resolveBookingWindowSetting } from '../orders/booking-window';

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
  /**
   * عدد الفنيين المؤهّلين اللي **يومهم فاضي بالكامل** (صفر دقيقة محجوزة) — إشارة التسلسل
   * (ADR-0096، docs/08 §150 بند ١).
   *
   * الفرق عن `availableTechnicians` جوهري: ده بيعدّ اللي **تحت السقف اليومي** (يعني ممكن
   * يكون عنده شغل ولسه بيقبل)، وده بيعدّ اللي **ما بدأش يومه أصلاً**. من غير التفرقة دي،
   * الاقتراح بيفضل يرمي الشغل على نفس اليوم المزنوق طالما لسه فيه فسحة فيه.
   */
  idleTechnicians: number;
  /** أول يوم مقترح بعد مهلة الحجز — «أقرب فرصة». */
  isEarliest: boolean;
}

/** صف طاقة يوم واحد كما بيتخزّن في الكاش — الشكل ده بيتقري من Redis فتغييره لازم يتعامل معاه. */
interface DayCapacityRow {
  day: string;
  availableTechnicians: number;
  idleTechnicians: number;
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
    private readonly cache: RedisCacheService,
  ) {}

  /**
   * طاقة الأفق (٢١ يوم × كل شرط أهلية حقيقي) أغلى استعلام في المسار — مقاس **٢٢٣ms** لـ٢٥ فني
   * على قاعدة تطوير فاضية، وبيكبر مع عدد الفنيين والحمل. وده سبب «الاقتراحات بتاخد ثانيتين
   * تلاتة» في بلاغ المالك.
   *
   * الكاش هنا آمن لأن الاقتراح **استشاري**: الحجز الحقيقي بيعيد التحقق من الإتاحة تحت قفل
   * وقت إنشاء الطلب، فاقتراح عمره ٩٠ ثانية أسوأ حالاته إنه يقترح يوم اتملى للتو — وده نفس
   * سباق أي عميلين بيحجزوا في نفس اللحظة، وموجود أصلاً ومتعامل معاه.
   *
   * المفتاح مالوش علاقة بالعميل — الطاقة خاصية (خدمة × نطاق × مدة)، فالعملاء اللي بيبصّوا على
   * نفس الخدمة في نفس المنطقة بيتشاركوا نفس الحساب. وأي فشل في Redis بيرجع للقاعدة بهدوء
   * (`RedisCacheService` بيبلع الاستثناء ويرجّع null).
   */
  /**
   * **حساب واحد لكل مفتاح في اللحظة الواحدة** (قياس حمل 2026-09-16، docs/08 §152).
   *
   * الكاش بيغطّي الطلب التاني وما بعده، لكنه **مابيغطّيش الطلبات المتوازية على مفتاح بارد**:
   * كلهم بيلاقوا الكاش فاضي في نفس اللحظة، فكلهم بيحسبوا. مقاس حيًا على ٤٠ فني:
   *
   *   ٢٠ نداء متوازي على مفتاح **بارد** = ٢٣٠٩ms   ← كل واحد بيحسب لوحده
   *   ٢٠ نداء متوازي على مفتاح **ساخن** =   ٩١ms
   *
   * وده بالظبط شكل «جزء صغير يبقى أبطأ من باقي السيستم ويسبب lag تحت الضغط»: الحساب ده أغلى
   * استعلام في مسار الحجز، فتكراره N مرة بيستهلك اتصالات القاعدة ويأخّر كل حاجة تانية معاه.
   *
   * الخريطة دي بتخلّي أول طلب يحسب والباقي **يستنى نفس الوعد**. مفتاح الخريطة هو نفس مفتاح
   * الكاش، والصف بيتشال في `finally` فأي فشل مايسيبش وعد ميت محفوظ للأبد.
   *
   * **مقصود إنها في الذاكرة (لكل نسخة) مش قفل موزّع**: نسخ الـAPI المتعددة أسوأ حالاتها حساب
   * واحد لكل نسخة بدل واحد للكل — تحسّن بنفس الترتيب تقريبًا، بلا أي تعقيد قفل موزّع في مسار
   * **استشاري** بحت (الحجز الحقيقي بيعيد التحقق تحت قفل على أي حال).
   */
  private readonly inFlightDayCapacity = new Map<string, Promise<DayCapacityRow[]>>();

  private async cachedDayCapacity(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<DayCapacityRow[]>,
  ): Promise<DayCapacityRow[]> {
    if (ttlSeconds <= 0) return compute();
    const inFlight = this.inFlightDayCapacity.get(key);
    if (inFlight) return inFlight;
    const pending = this.cachedDayCapacityUncoalesced(key, ttlSeconds, compute).finally(() => {
      this.inFlightDayCapacity.delete(key);
    });
    this.inFlightDayCapacity.set(key, pending);
    return pending;
  }

  private async cachedDayCapacityUncoalesced(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<DayCapacityRow[]>,
  ): Promise<DayCapacityRow[]> {
    const cached = await this.cache.get(key);
    if (cached) {
      try {
        const parsed: unknown = JSON.parse(cached);
        // صفوف قديمة في الكاش (قبل ما `idleTechnicians` تتضاف) بتتجاهل بدل ما تتقري كصفر —
        // صفر هنا معناه «مفيش حد فاضي» وهي معلومة غلط بتقلب الترتيب.
        if (Array.isArray(parsed) && parsed.every((row) => typeof (row as DayCapacityRow)?.idleTechnicians === 'number')) {
          return parsed as DayCapacityRow[];
        }
      } catch {
        // صف كاش تالف — نتجاهله ونحسب من القاعدة. مش سبب لتعطيل الاقتراح.
      }
    }
    const fresh = await compute();
    await this.cache.set(key, JSON.stringify(fresh), Math.round(ttlSeconds));
    return fresh;
  }

  private async config() {
    const [
      leadHours, horizonDays, count, dayStartHour, dayEndHour, roominessRatio,
      delayPenaltyPerDay, minDaySpacing, minHourSpacing, cacheTtlSeconds, sequencingWeight,
      bookingWindow,
    ] = await Promise.all([
      this.settingsService.getNumber('booking.suggestion_lead_hours', 48),
      this.settingsService.getNumber('booking.suggestion_horizon_days', 21),
      this.settingsService.getNumber('booking.suggestion_count', 3),
      this.settingsService.getNumber('booking.suggestion_day_start_hour', 9),
      this.settingsService.getNumber('booking.suggestion_day_end_hour', 19),
      this.settingsService.getNumber('booking.suggestion_roominess_ratio', 0.7),
      this.settingsService.getNumber('booking.suggestion_delay_penalty_per_day', 0.04),
      this.settingsService.getNumber('booking.suggestion_min_day_spacing', 2),
      this.settingsService.getNumber('booking.suggestion_min_hour_spacing', 3),
      this.settingsService.getNumber('booking.suggestion_cache_ttl_seconds', 90),
      this.settingsService.getNumber('booking.suggestion_sequencing_weight', 0.5),
      resolveBookingWindowSetting(this.settingsService),
    ]);
    // **نافذة الاقتراح محصورة جوّه نافذة الحجز** (ADR-0097). اقتراح ساعة العميل مش هيعرف
    // يحجزها هو بالظبط نفس فئة البَقّة اللي ADR-0096 اتكتب عشانها — وعد بحاجة القايمة اللي
    // بعدها مابتحترمهاش. فالحصر هنا مش تجميل، هو نفس قاعدة «الاقتراح لازم يكون قابل للحجز».
    const windowedStartHour = Math.max(dayStartHour, bookingWindow.startHour);
    const windowedEndHour = Math.min(dayEndHour, bookingWindow.endHour);
    return {
      leadHours, horizonDays, count, roominessRatio,
      dayStartHour: windowedStartHour,
      // لو الإعدادين اتقاطعوا لدرجة إن النافذة اتقلبت، بنرجع لنافذة الحجز نفسها بدل ما نرجّع
      // صفر ساعات (الاقتراح بيختفي بلا سبب ظاهر للأدمن).
      dayEndHour: windowedStartHour <= windowedEndHour ? windowedEndHour : bookingWindow.endHour,
      bookingWindow,
      delayPenaltyPerDay, minDaySpacing, minHourSpacing, cacheTtlSeconds,
      // القيمة بتتحصر في [0,1] هنا مش عند القراءة: إعداد غلط (سالب أو أكبر من ١) كان هيقلب
      // إشارة الدرجة ويطلّع ترتيب مالوش أي معنى بدل ما يتجاهل بهدوء.
      sequencingWeight: Math.min(1, Math.max(0, sequencingWeight)),
    };
  }

  /**
   * اختيار جشع بدرجة = وفرة − غرامة تأخير − غرامة تقارب.
   *
   * **البلاغ اللي الدالة دي اتكتبت عشانه (docs/08 §146)**: «بتسيب ٤٨ ساعة وتروح مديها تلات
   * أيام كده». السبب إن الترتيب القديم كان «الأقرب من بين اللي فوق عتبة رخوة» — ولما الطاقة
   * متساوية (الحالة الغالبة) العتبة بتعدّي الكل، فالنتيجة حرفيًا أول تلات أيام ورا بعض،
   * وتلات ساعات ورا بعض. اقتراح مالوش أي معلومة.
   *
   * التلات حدود بتشتغل مع بعض:
   *  - **الوفرة** (`ratio`) بتخلّي يوم فيه صنايعية كتير يكسب يوم فاضي حتى لو أبعد.
   *  - **غرامة التأخير** بتمنع إننا نروح لأسبوعين لمجرد فني زيادة (طلب المالك القديم:
   *    «ما يبقاش يوم بعيد أوي»).
   *  - **غرامة التقارب** بتفرد الاقتراحات لما الدرجات تتساوى، فالعميل يشوف اختيار حقيقي
   *    (الثلاثا / الجمعة / الأحد) بدل تلات أيام متلاصقة.
   */
  private pickSpread<T>(
    items: T[],
    opts: {
      count: number;
      minSpacing: number;
      /** موضع العنصر على المحور (رقم اليوم أو رقم الساعة) — المسافة بتتقاس بيه. */
      positionOf: (item: T) => number;
      /** درجة أساسية في [0,1] قبل أي غرامة. */
      scoreOf: (item: T) => number;
    },
  ): T[] {
    const SPACING_PENALTY = 0.15;
    const picked: T[] = [];
    const remaining = [...items];
    while (picked.length < opts.count && remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const position = opts.positionOf(remaining[index]);
        const tooClose = picked.some(
          (chosen) => Math.abs(opts.positionOf(chosen) - position) < opts.minSpacing,
        );
        const score = opts.scoreOf(remaining[index]) - (tooClose ? SPACING_PENALTY : 0);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      picked.push(remaining.splice(bestIndex, 1)[0]);
    }
    return picked;
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
  }): Promise<{ days: SuggestedDay[]; leadHours: number; horizonDays: number; bookingWindow: BookingWindow }> {
    const zoneId = await this.resolveZone(opts.customerUserId, opts.addressId);
    const cfg = await this.config();
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);

    // مفتاح الكاش بيضم كل حاجة بتغيّر الناتج، وتاريخ اليوم بتوقيت مصر عشان الأفق يتزحزح مع
    // منتصف الليل بدل ما يفضل مثبّت على يوم امبارح.
    const cairoToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const cacheKey = [
      'booking:suggest:days', cairoToday, opts.serviceId, zoneId,
      opts.durationMinutes ?? '-', opts.estimatedDurationDays ?? '-',
      cfg.leadHours, cfg.horizonDays,
    ].join(':');

    const withCapacity = await this.cachedDayCapacity(cacheKey, cfg.cacheTtlSeconds, async () => {
    const rows = await this.dataSource.query<{ day: string; available_technicians: string; idle_technicians: string }[]>(
      `
      WITH bounds AS (
        SELECT ((now() AT TIME ZONE 'Africa/Cairo') + make_interval(hours => $4::int))::date AS first_day
      ),
      days AS (
        SELECT gs::date AS day,
               (gs::date::timestamp AT TIME ZONE 'Africa/Cairo') AS day_start
          FROM bounds b,
               generate_series(b.first_day, b.first_day + make_interval(days => $5::int), interval '1 day') gs
      ),
      -- **المجمّع بيتحسب مرة واحدة، مش مرة لكل يوم** (قياس أداء 2026-09-16، docs/08 §152).
      --
      -- شروط الخدمة/النطاق/الموقع/الحصرية **مالهاش علاقة باليوم**، فكانت بتتنفّذ ٢٢ مرة على
      -- الفاضي جوّه الـLATERAL. اللي بيتغيّر باليوم هو شرط الإتاحة وحده، وهو الوحيد اللي فضل
      -- جوّه الـLATERAL تحت.
      pool AS (
        SELECT tp.id, svc.estimated_duration_minutes AS service_minutes
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
      ),
      -- وحمل الأيام كمان مرة واحدة للمجمّع كله، بدل استعلام مترابط لكل (يوم × فني).
      -- الدالة دي بترجّع صف لكل يوم مشغول أصلاً، فالفلترة باليوم بقت JOIN عادي تحت.
      -- ده كان **١١٨ms من ٣٩٦** على ٤٠ فني (٤٢٪) قبل التغيير — مقاس، مش تقدير.
      day_load AS (
        SELECT p.id AS technician_id, lo.busy_day, lo.busy_minutes
          FROM pool p
          CROSS JOIN LATERAL ${technicianDayLoadSubquery({
            technicianIdExpr: 'p.id',
            activeStatusesParam: '$6',
            excludeOrderIdParam: '$9',
            dailyCapacityParam: '$3',
          })} lo
      )
      SELECT d.day::text AS day,
             COUNT(*)::text AS available_technicians,
             -- إشارة التسلسل (ADR-0096): مين **ما بدأش يومه** خالص، مش مين لسه تحت السقف.
             COUNT(*) FILTER (WHERE COALESCE(dl.busy_minutes, 0) = 0)::text AS idle_technicians
        FROM days d
        CROSS JOIN LATERAL (
          SELECT pool.id, pool.service_minutes
            FROM pool
           WHERE true
             ${technicianAvailabilityCondition({
               technicianIdExpr: 'pool.id',
               // اليوم المرشّح بيتحقن كتعبير من الـLATERAL بدل parameter ثابت — ده اللي بيخلّي
               // الأفق كله استعلام واحد بدل نداء لكل يوم.
               scheduledAtParam: 'd.day_start',
               excludeOrderIdParam: '$9',
               activeStatusesParam: '$6',
               engagedStatusesParam: '$7',
               isEmergencyParam: '$8',
               serviceDurationExpr: 'COALESCE($10::int, COALESCE(pool.service_minutes, 60))',
               candidateLoad: {
                 estimatedDurationDaysExpr: '$11::numeric',
                 durationMinutesExpr: '$10::int',
                 serviceDefaultMinutesExpr: 'pool.service_minutes',
               },
               preciseDurationHoursExpr: '$10::numeric / 60.0',
               dailyCapacityMinutesParam: '$3',
               // **الحمل بيتقرا من `day_load` الجاهز، مش باستعلام جديد لكل يوم** (ADR-0100).
               //
               // `technicianDayLoadSubquery` مترابطة بمعرّف الفني، فجوّه فحص السقف كانت
               // بتتنفّذ **مرة لكل يوم في مدى الشغل** — ولمّا المدى بقى حقيقي انفجرت التكلفة:
               // ٢٦٤ms لمدى يوم ⇒ ٤٦٣٥ms لمدى ٥ أيام على ٤٠ فني (مقاس، مش تقدير). و`day_load`
               // فوق أصلاً بتحسب نفس الأرقام **مرة واحدة** لكل (فني، يوم)، فكانت بتتحسب
               // مرتين — مرة للعدّ ومرة (متكررة) للفحص.
               //
               // القاعدة نفسها مالمسناهاش: `dailyCapacityExceededExpr` هي هي، والمتغيّر هو
               // **من فين بتقرا الأرقام** بس.
               dayLoadRelation: `(
                 SELECT ready.busy_day, ready.busy_minutes
                   FROM day_load ready
                  WHERE ready.technician_id = pool.id
               )`,
             })}
        ) elig
        LEFT JOIN day_load dl ON dl.technician_id = elig.id AND dl.busy_day = d.day
       GROUP BY d.day
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

      return rows
        .map((row) => ({
          day: row.day,
          availableTechnicians: Number(row.available_technicians),
          idleTechnicians: Number(row.idle_technicians),
        }))
        .filter((row) => row.availableTechnicians > 0);
    });

    if (withCapacity.length === 0) {
      return { days: [], leadHours: cfg.leadHours, horizonDays: cfg.horizonDays, bookingWindow: cfg.bookingWindow };
    }

    const best = Math.max(...withCapacity.map((row) => row.availableTechnicians));
    const bestIdle = Math.max(...withCapacity.map((row) => row.idleTechnicians));
    const firstDay = withCapacity[0].day;
    const dayIndexOf = (day: string) =>
      Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000);

    // **وزن التسلسل** (ADR-0096، بلاغ المالك §150 بند ١: «تكون بسيكوانس بالترتيب… مش واحد
    // قاعد يوم والتاني محجوز خمسة»).
    //
    // «الوفرة» لوحدها بتجاوب «فيه كام حد لسه بيقبل شغل؟» — وهي إجابة بتخلّي الاقتراح يرصّ
    // الشغل على نفس اليوم طالما لسه فيه فسحة. «التسلسل» بيجاوب «فيه حد يومه لسه ما بدأش؟» —
    // وهي اللي بتوزّع الشغل على الناس وتخلّي التقويم يتملي بالترتيب.
    //
    // صفر = السلوك القديم بالحرف. ١ = الوفرة بتتجاهل تمامًا. الافتراضي بينهم لأن الاتنين
    // معلومة حقيقية: يوم فيه فاضي واحد بس وزحمة عامة مش أحسن من يوم فيه تلاتة نص فاضيين.
    const sequencingOf = (row: DayCapacityRow) => (bestIdle > 0 ? row.idleTechnicians / bestIdle : 0);
    const abundanceOf = (row: DayCapacityRow) => row.availableTechnicians / best;

    const days = this.pickSpread(withCapacity, {
      count: Math.max(1, Math.round(cfg.count)),
      minSpacing: Math.max(1, Math.round(cfg.minDaySpacing)),
      positionOf: (row) => dayIndexOf(row.day),
      // وفرة + تسلسل، ناقص غرامة تأخير عن أول يوم متاح.
      scoreOf: (row) =>
        (1 - cfg.sequencingWeight) * abundanceOf(row) +
        cfg.sequencingWeight * sequencingOf(row) -
        cfg.delayPenaltyPerDay * dayIndexOf(row.day),
    })
      // العرض بترتيب التاريخ عشان القايمة تتقرا طبيعي، بعد ما الاختيار اتعمل بالدرجة.
      .sort((left, right) => left.day.localeCompare(right.day))
      .map((row, index) => ({ ...row, isEarliest: index === 0 }));

    return { days, leadHours: cfg.leadHours, horizonDays: cfg.horizonDays, bookingWindow: cfg.bookingWindow };
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
    estimatedDurationDays?: number | null;
  }): Promise<{ times: SuggestedTime[] }> {
    const zoneId = await this.resolveZone(opts.customerUserId, opts.addressId);
    const cfg = await this.config();
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    // **نافذة الساعة ≠ حمل الشغلانة** (ADR-0100 §5). الاتنين كانوا رقم واحد (`$7`)، وده كان
    // بيكسر الاتجاهين لشغل ممتد: نافذة تقاطع بـ٦٠ ساعة من ناحية، ومدى مرشّح بيوم واحد من ناحية.
    //
    //  - `slotWindowMinutes` = «لو بدأ الساعة دي، بياخد قد إيه من اليوم ده» — بيتحصر على السقف
    //    اليومي، وهو اللي بيتقارن بتقاطع الطلبات القائمة.
    //  - `jobMinutes`/`jobDays` = حمل الشغلانة **كامل**، وهو اللي `candidateSpanDaysFromSource()`
    //    بتشتق منه المدى الحقيقي فتتفحص كل أيام الشغل مش يوم البداية بس.
    const jobMinutes = opts.durationMinutes ?? null;
    const slotWindowMinutes = Math.max(30, Math.min(jobMinutes ?? 60, Math.round(dailyCapacityMinutes)));

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
           -- **بوابة الحجز الحقيقية، مش التداخل الساعي وبس** (بلاغ مالك 2026-09-15،
           -- docs/08 §150 بند ١، ADR-0096).
           --
           -- الاستعلام ده كان بيعدّ الأهلية الأساسية (خدمة + نطاق) وبعدين يشيل المتقاطع مع
           -- الساعة — من غير شرط الإتاحة. يعني فني **عدّى سقفه اليومي** (مش قابل للحجز خالص)
           -- كان بيتعدّ «فاضي الساعة ٢»، والعميل يشوف «اتنين من ستة فاضيين» وبعدين القايمة
           -- اللي بعدها مافيهاش الرقم ده ولا الأسماء دي.
           --
           -- الشرط ده هو نفسه اللي اقتراح الأيام وقايمة اختيار الفني والتوزيع بيقروه، ففلتر
           -- الساعة تحت بقى **مجموعة جزئية منه** — مستحيل يوعد بأكتر مما الحجز بيسمح به.
           ${technicianAvailabilityCondition({
             technicianIdExpr: 'tp.id',
             // الأقواس الخارجية **ضرورية**: الشرط بيلحق `::timestamptz` بالتعبير، ومن غيرها
             // الكاست بيتطبّق على اسم المنطقة الزمنية نفسه (اتلقط حيًا: «invalid input syntax
             // for type timestamp with time zone: Africa/Cairo»).
             scheduledAtParam: "(($3::text || ' 00:00')::timestamp AT TIME ZONE 'Africa/Cairo')",
             excludeOrderIdParam: 'NULL',
             activeStatusesParam: '$6',
             engagedStatusesParam: '$8',
             isEmergencyParam: 'false',
             serviceDurationExpr: 'COALESCE($10::int, COALESCE(svc.estimated_duration_minutes, 60))',
             // نفس مصدر الحمل بتاع `suggestDays` بالحرف — الشغلانة الممتدة بيتفحص مداها كله
             // (ADR-0100 §5). `NULL::numeric` المكتوبة نصًا هنا قبل كده كانت بتثبّت المدى على
             // يوم واحد مهما كانت مدة الشغل.
             candidateLoad: {
               estimatedDurationDaysExpr: '$11::numeric',
               durationMinutesExpr: '$10::int',
               serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
             },
             preciseDurationHoursExpr: '$10::numeric / 60.0',
             dailyCapacityMinutesParam: '$9',
           })}
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
        slotWindowMinutes,
        // ($8, $9) بوابة الحجز الحقيقية جوّه `eligible` — نفس مدخلات `suggestDays` بالحرف.
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        dailyCapacityMinutes,
        // ($10, $11) حمل الشغلانة كامل — منفصل عن نافذة الساعة ($7) عن قصد.
        jobMinutes,
        opts.estimatedDurationDays ?? null,
      ],
    );

    const available = rows
      .map((row) => ({ time: row.hour, freeTechnicians: Number(row.free_technicians) }))
      .filter((row) => row.freeTechnicians > 0);
    if (available.length === 0) return { times: [] };

    const bestFree = Math.max(...available.map((row) => row.freeTechnicians));
    const times = this.pickSpread(available, {
      count: Math.max(1, Math.round(cfg.count)),
      minSpacing: Math.max(1, Math.round(cfg.minHourSpacing)),
      positionOf: (row) => Number(row.time.slice(0, 2)),
      // **مفيش غرامة تأخير هنا عمدًا**: الساعة الأبكر مش «أحسن» زي اليوم الأقرب. الفرق الوحيد
      // اللي يهم هو الفراغ، والتقارب بيتكسر بالفرد على اليوم (صباح/ضهر/بعد الضهر) بدل تلات
      // ساعات متلاصقة أول النافذة.
      scoreOf: (row) => row.freeTechnicians / bestFree,
    })
      // العرض بترتيب الساعة عشان القايمة تتقرا طبيعي، بعد ما الاختيار اتعمل بالدرجة.
      .sort((left, right) => left.time.localeCompare(right.time));

    return { times };
  }
}
