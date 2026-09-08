import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { SettingsService } from '../settings/settings.service';
import { OPERATING_TIMEZONE } from './metric-definitions';

/** كل ساعة — التجميع اليومي مالوش أي إلحاح، والدورة كلها استعلامين. */
const ROLLUP_INTERVAL_MS = 60 * 60 * 1000;

/** الأيام اللي بتتعاد كل دورة. يومين كفاية: أمبارح خلص، والنهارده لسه بيتغيّر. */
const ROLLUP_LOOKBACK_DAYS = 3;

/** الاحتفاظ الافتراضي بالأحداث الخام — نصف سنة (ADR-0081 §4). */
export const FUNNEL_RETENTION_DAYS_FALLBACK = 180;

/** سقف الحذف في الدورة الواحدة — الحذف بيتم على دفعات عشان مايقفلش الجدول لدقايق. */
const PURGE_BATCH = 5_000;

/**
 * تجميع الفنل اليومي + تنضيف الأحداث القديمة (ADR-0081 §4).
 *
 * **الجدول المجمّع مشتق بالكامل، مش عدّاد.** الدورة بتعيد حساب اليوم من الأحداث الخام
 * وبتكتبه `UPSERT`، فتشغيلها مرتين بيدّي نفس النتيجة بالظبط. ده مقصود ومهم: المشروع عنده تلات
 * بَقّات موثّقة كانت **عدّادات بتتزوّد** ونسي حد يزوّدها في مسار جديد فاتجمّدت على أصفار.
 * العدّاد اللي بيتعاد حسابه مستحيل يتجمّد — أسوأ حاجة تحصل إن الدورة تقف، وساعتها الرقم
 * بيبان قديم بتاريخه مش غلط بقيمته.
 *
 * الدورة نفسها `setInterval` مش BullMQ — نفس سبب `ProductivityLearningService` بالظبط:
 * استقلال عن بَقّة إعادة اتصال الـWorker الموثّقة في `technicians/README.md`.
 */
@Injectable()
export class AnalyticsRollupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsRollupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس بتشغّل الدورة حتى لو التطبيق على أكتر
      // من instance — وإلا الحذف والتجميع بيتزاحموا على نفس الصفوف.
      void runExclusiveSweep(this.dataSource, 'analytics-funnel-rollup', () => this.runCycle(), this.logger);
    }, ROLLUP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** دورة كاملة: تجميع الأيام القريبة ثم تنضيف الخام القديم. */
  async runCycle(): Promise<{ rolledDays: number; purgedEvents: number }> {
    const rolledDays = await this.rollupRecentDays();
    const purgedEvents = await this.purgeOldEvents();
    return { rolledDays, purgedEvents };
  }

  /**
   * إعادة حساب آخر `ROLLUP_LOOKBACK_DAYS` أيام. **مش «الأيام اللي ما اتجمّعتش»** — حدث ممكن
   * يتسجّل بتاريخ قديم (طلب اتعمل قبل نص الليل والتسجيل عدّى بعده)، فإعادة الحساب بتصلّح
   * نفسها لوحدها بدل ما تسيب يوم ناقص للأبد.
   */
  async rollupRecentDays(lookbackDays = ROLLUP_LOOKBACK_DAYS): Promise<number> {
    const rows = await this.dataSource.query<{ day: string }[]>(
      `INSERT INTO booking_funnel_daily (day, stage, sessions, events, failed_events)
       SELECT (e.occurred_at AT TIME ZONE $2)::date AS day,
              e.stage,
              COUNT(DISTINCT e.funnel_session_id) AS sessions,
              COUNT(*) AS events,
              COUNT(*) FILTER (WHERE e.outcome = 'failed') AS failed_events
         FROM booking_funnel_events e
        WHERE e.occurred_at >= (now() - ($1 || ' days')::interval)
        GROUP BY 1, 2
       ON CONFLICT (day, stage) DO UPDATE
          SET sessions = EXCLUDED.sessions,
              events = EXCLUDED.events,
              failed_events = EXCLUDED.failed_events
       RETURNING day`,
      [String(lookbackDays), OPERATING_TIMEZONE],
    );
    return new Set(rows.map((r) => String(r.day))).size;
  }

  /**
   * حذف الأحداث الخام الأقدم من مدة الاحتفاظ — **بعد** ما تكون اتجمّعت.
   *
   * الحذف على دفعات بـ`ctid`: `DELETE ... WHERE occurred_at < x` على مليون صف بيقفل الجدول
   * لدقايق ويأثّر على مسار الحجز نفسه (نفس الجدول اللي `FunnelTrackerService` بيكتب فيه).
   */
  async purgeOldEvents(): Promise<number> {
    const retentionDays = await this.settings.getNumber(
      'analytics.funnel_retention_days',
      FUNNEL_RETENTION_DAYS_FALLBACK,
    );
    // حارس صريح: إعداد بصفر أو سالب كان هيمسح كل السجل في دورة واحدة. الحد الأدنى أسبوع.
    const safeDays = Math.max(7, Math.floor(retentionDays));

    let total = 0;
    for (;;) {
      const result = await this.dataSource.query<{ id: string }[]>(
        `DELETE FROM booking_funnel_events
          WHERE ctid IN (
            SELECT ctid FROM booking_funnel_events
             WHERE occurred_at < (now() - ($1 || ' days')::interval)
             LIMIT ${PURGE_BATCH}
          )
        RETURNING id`,
        [String(safeDays)],
      );
      total += result.length;
      if (result.length < PURGE_BATCH) break;
    }
    if (total > 0) {
      this.logger.log(`تنضيف أحداث الفنل: اتمسح ${total} حدث أقدم من ${safeDays} يوم`);
    }
    return total;
  }

  /**
   * الفنل التاريخي من الجدول المجمّع — للمدى اللي الخام مابيغطّيهوش.
   *
   * بيرجّع صف لكل (يوم، مرحلة) عشان اللوحة تقدر ترسم اتجاه عبر الشهور، مش رقم واحد مجمّع
   * يخفي إن التسريب اتحسّن أو اتوحّش.
   */
  historicalDaily(from: Date, to: Date): Promise<{ day: string; stage: string; sessions: number; events: number; failed_events: number }[]> {
    return this.dataSource.query(
      `SELECT day::text AS day, stage, sessions, events, failed_events
         FROM booking_funnel_daily
        WHERE day >= ($1::timestamptz AT TIME ZONE $3)::date
          AND day <= ($2::timestamptz AT TIME ZONE $3)::date
        ORDER BY day ASC, stage ASC`,
      [from, to, OPERATING_TIMEZONE],
    );
  }
}
