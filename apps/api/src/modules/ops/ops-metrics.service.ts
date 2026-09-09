import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import * as os from 'node:os';
import { DataSource } from 'typeorm';
import { DbPoolMonitorService } from '../../database/db-pool-monitor.service';
import { RequestMetricsService } from '../../common/observability/request-metrics.service';
import { MATCHING_ROUNDS_QUEUE } from '../matching/matching-rounds.queue';
import { ASSISTANT_MATCHING_QUEUE } from '../assistant-matching/assistant-matching.queue';
import { CUSTOMER_STATS_QUEUE } from '../customers/customer-stats.queue';
import { TECHNICIAN_STATS_QUEUE } from '../technicians/technician-stats.queue';
import { SettingsService } from '../settings/settings.service';

/**
 * **لوحة الإشارات الواحدة للمراقبة الخارجية (ج-٧).**
 *
 * المالك سأل عن سبع إشارات بالاسم: 5xx، زمن الاستجابة، CPU/RAM، اتصالات القاعدة، الوظايف
 * الفاشلة، الدفعات الفاشلة، والطلبات العالقة. كانوا موجودين **مبعثرين وبأشكال مختلفة**:
 * `/health` (قاعدة + pool)، `QueueWatchdogService` (طوابير، بيتصرّف مايعرضش)، Exception Center
 * (طلبات عالقة، شاشة أدمن بشرية)، ولوحة المال (تسويات). والـ5xx والزمن مكانوش موجودين في
 * الإنتاج **أصلاً** (سجل الأعطال متوقّف هناك عمدًا).
 *
 * مبعثرين = **مفيش إنذار**. المراقبة الخارجية محتاجة نقطة واحدة تقرا منها، وقاعدة إنذار واحدة
 * تقف عليها. الخدمة دي بتجمّع السبعة في رد واحد، وبتحسب **حالة عامة** (`ok`/`warn`/`critical`)
 * مع قايمة أسباب مقروءة — فقاعدة الإنذار كلها بتبقى: `status != "ok"`.
 *
 * **العتبات كلها إعدادات** (`ops.alert_*`) مش أرقام في الكود: اللي بيضبط الحساسية هو اللي شايف
 * حجم الشغل الحقيقي، ومن غير كده أي تعديل بيتطلب deploy (وده بند ج-١٨ بالظبط).
 */

export type OpsSeverity = 'ok' | 'warn' | 'critical';

export interface OpsAlert {
  key: string;
  severity: Exclude<OpsSeverity, 'ok'>;
  /** رسالة عربية بتقول **الرقم والعتبة** — إنذار من غير رقم بيتجاهَل. */
  message: string;
}

export interface QueueSnapshot {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  oldestWaitingMinutes: number | null;
}

const DEFAULTS = {
  serverErrorRate: 0.05,
  serverErrorRateCritical: 0.2,
  latencyP95Ms: 3_000,
  latencyP95CriticalMs: 10_000,
  poolWaiting: 1,
  queueStallMinutes: 5,
  queueFailed: 20,
  failedPaymentsPerHour: 10,
  stuckSearchingMinutes: 30,
  memoryRssMb: 1_500,
};

@Injectable()
export class OpsMetricsService {
  private readonly queues: { name: string; queue: Queue }[];

  constructor(
    @InjectQueue(MATCHING_ROUNDS_QUEUE) matching: Queue,
    @InjectQueue(ASSISTANT_MATCHING_QUEUE) assistant: Queue,
    @InjectQueue(CUSTOMER_STATS_QUEUE) customerStats: Queue,
    @InjectQueue(TECHNICIAN_STATS_QUEUE) technicianStats: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly pool: DbPoolMonitorService,
    private readonly requests: RequestMetricsService,
    private readonly settings: SettingsService,
  ) {
    this.queues = [
      { name: MATCHING_ROUNDS_QUEUE, queue: matching },
      { name: ASSISTANT_MATCHING_QUEUE, queue: assistant },
      { name: CUSTOMER_STATS_QUEUE, queue: customerStats },
      { name: TECHNICIAN_STATS_QUEUE, queue: technicianStats },
    ];
  }

  private async threshold(key: keyof typeof DEFAULTS): Promise<number> {
    return this.settings.getNumber(`ops.alert_${snake(key)}`, DEFAULTS[key]);
  }

  async collect() {
    const [requests, queues, business, thresholds] = await Promise.all([
      Promise.resolve(this.requests.snapshot()),
      this.queueSnapshots(),
      this.businessSignals(),
      this.thresholds(),
    ]);
    const pool = this.pool.snapshot();
    const process_ = processSnapshot();
    const alerts = this.evaluate({ requests, queues, business, pool, process: process_, thresholds });

    return {
      status: worst(alerts),
      alerts,
      // **الأرقام الخام معروضة كمان**: الإنذار بيقول «فيه مشكلة»، والأرقام بتقول «قد إيه وفين».
      // من غيرها، أول سؤال بعد الإنذار بيحتاج SSH.
      requests,
      queues,
      business,
      database: { pool },
      process: process_,
      thresholds,
      collectedAt: new Date().toISOString(),
    };
  }

  private async thresholds() {
    const keys = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];
    const values = await Promise.all(keys.map((key) => this.threshold(key)));
    return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as Record<keyof typeof DEFAULTS, number>;
  }

  private async queueSnapshots(): Promise<QueueSnapshot[]> {
    return Promise.all(
      this.queues.map(async ({ name, queue }): Promise<QueueSnapshot> => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
          const [oldest] = await queue.getWaiting(0, 0);
          return {
            name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            oldestWaitingMinutes: oldest ? Number(((Date.now() - oldest.timestamp) / 60_000).toFixed(1)) : null,
          };
        } catch {
          // Redis واقع: بنرجّع `-1` كعلامة «مش معروف» بدل صفر كاذب يطمّن الإنذار.
          return { name, waiting: -1, active: -1, failed: -1, delayed: -1, oldestWaitingMinutes: null };
        }
      }),
    );
  }

  /**
   * الإشارات المشتقّة من القاعدة. كلها استعلامات محدودة بفترة زمنية وبفهارس موجودة — الصفحة دي
   * المفروض المراقبة تندهها كل دقيقة، فمينفعش تبقى تقيلة.
   */
  private async businessSignals() {
    const [row] = await this.dataSource.query<
      {
        failed_payments_last_hour: number;
        stuck_searching: number;
        oldest_searching_minutes: number | null;
        overdue_accepted: number;
        open_disputes: number;
        pending_payout_reviews: number;
      }[]
    >(
      `SELECT
         (SELECT count(*)::int FROM payments
           WHERE payment_status = 'failed' AND initiated_at >= now() - interval '1 hour') AS failed_payments_last_hour,
         (SELECT count(*)::int FROM orders
           WHERE order_status = 'searching_technician' AND deleted_at IS NULL
             AND COALESCE(placed_at, created_at) <= now() - interval '30 minutes') AS stuck_searching,
         (SELECT ROUND(EXTRACT(EPOCH FROM (now() - MIN(COALESCE(placed_at, created_at)))) / 60)::int FROM orders
           WHERE order_status = 'searching_technician' AND deleted_at IS NULL) AS oldest_searching_minutes,
         (SELECT count(*)::int FROM orders
           WHERE order_status = 'accepted' AND deleted_at IS NULL
             AND scheduled_at < date_trunc('day', now() AT TIME ZONE 'Africa/Cairo')) AS overdue_accepted,
         (SELECT count(*)::int FROM orders
           WHERE order_status = 'disputed' AND deleted_at IS NULL) AS open_disputes,
         (SELECT count(*)::int FROM payouts WHERE payout_status = 'under_review') AS pending_payout_reviews`,
    );
    return row;
  }

  private evaluate(input: {
    requests: ReturnType<RequestMetricsService['snapshot']>;
    queues: QueueSnapshot[];
    business: Awaited<ReturnType<OpsMetricsService['businessSignals']>>;
    pool: ReturnType<DbPoolMonitorService['snapshot']>;
    process: ReturnType<typeof processSnapshot>;
    thresholds: Record<keyof typeof DEFAULTS, number>;
  }): OpsAlert[] {
    const { requests, queues, business, pool, process: proc, thresholds } = input;
    const alerts: OpsAlert[] = [];

    // **نسبة مش عدد**: عشرة أعطال في مليون طلب مش نفس عشرة في خمسين. النسبة بتخلّي نفس العتبة
    // صالحة على أي حجم شغل.
    if (requests.total > 0 && requests.serverErrorRate >= thresholds.serverErrorRateCritical) {
      alerts.push({
        key: 'server_error_rate',
        severity: 'critical',
        message: `نسبة أعطال 5xx ${(requests.serverErrorRate * 100).toFixed(1)}% خلال آخر ${requests.windowMinutes} دقيقة (الحد الحرج ${(thresholds.serverErrorRateCritical * 100).toFixed(0)}%)`,
      });
    } else if (requests.total > 0 && requests.serverErrorRate >= thresholds.serverErrorRate) {
      alerts.push({
        key: 'server_error_rate',
        severity: 'warn',
        message: `نسبة أعطال 5xx ${(requests.serverErrorRate * 100).toFixed(1)}% خلال آخر ${requests.windowMinutes} دقيقة (الحد ${(thresholds.serverErrorRate * 100).toFixed(0)}%)`,
      });
    }

    if (requests.latencyMs.p95 >= thresholds.latencyP95CriticalMs) {
      alerts.push({
        key: 'latency_p95',
        severity: 'critical',
        message: `زمن الاستجابة p95 = ${requests.latencyMs.p95}ms (الحد الحرج ${thresholds.latencyP95CriticalMs}ms)`,
      });
    } else if (requests.latencyMs.p95 >= thresholds.latencyP95Ms) {
      alerts.push({
        key: 'latency_p95',
        severity: 'warn',
        message: `زمن الاستجابة p95 = ${requests.latencyMs.p95}ms (الحد ${thresholds.latencyP95Ms}ms)`,
      });
    }

    // انتظار على الـpool = طلبات واقفة مستنية اتصال. ده العدّاد اللي كان صامت وقت العطل الحقيقي.
    // `null` معناها الـpool لسه مش متاح (بدري في الإقلاع) — مش «صفر انتظار».
    if (pool && pool.waiting >= thresholds.poolWaiting) {
      alerts.push({
        key: 'db_pool_waiting',
        severity: pool.waiting >= thresholds.poolWaiting * 5 ? 'critical' : 'warn',
        message: `${pool.waiting} طلب مستني اتصال قاعدة (مفتوح ${pool.total}/${pool.max}، خامل ${pool.idle})`,
      });
    }

    for (const queue of queues) {
      if (queue.waiting < 0) {
        alerts.push({
          key: `queue_unreachable:${queue.name}`,
          severity: 'warn',
          message: `تعذّر قراءة حالة طابور ${queue.name} — Redis غالبًا مش متاح`,
        });
        continue;
      }
      if (queue.oldestWaitingMinutes !== null && queue.oldestWaitingMinutes >= thresholds.queueStallMinutes) {
        // نفس توقيع بَقّة BullMQ #4479 اللي `QueueWatchdogService` بيتصرّف فيها — بس هنا
        // **معروضة** كمان، عشان المراقبة تشوف الحادثة مش بس تلاقي الخدمة اتعاد تشغيلها.
        alerts.push({
          key: `queue_stalled:${queue.name}`,
          severity: 'critical',
          message: `طابور ${queue.name} فيه وظيفة واقفة ${queue.oldestWaitingMinutes} دقيقة (الحد ${thresholds.queueStallMinutes})`,
        });
      }
      if (queue.failed >= thresholds.queueFailed) {
        alerts.push({
          key: `queue_failed:${queue.name}`,
          severity: 'warn',
          message: `${queue.failed} وظيفة فاشلة في طابور ${queue.name} (الحد ${thresholds.queueFailed})`,
        });
      }
    }

    if (business.failed_payments_last_hour >= thresholds.failedPaymentsPerHour) {
      alerts.push({
        key: 'failed_payments',
        severity: 'critical',
        message: `${business.failed_payments_last_hour} عملية دفع فاشلة خلال آخر ساعة (الحد ${thresholds.failedPaymentsPerHour})`,
      });
    }

    if (
      business.oldest_searching_minutes !== null &&
      business.oldest_searching_minutes >= thresholds.stuckSearchingMinutes
    ) {
      alerts.push({
        key: 'stuck_orders',
        severity: business.stuck_searching > 0 ? 'critical' : 'warn',
        message: `${business.stuck_searching} طلب بيدوّر على فني من أكتر من ${thresholds.stuckSearchingMinutes} دقيقة (أقدم واحد ${business.oldest_searching_minutes} دقيقة)`,
      });
    }

    if (business.overdue_accepted > 0) {
      alerts.push({
        key: 'overdue_orders',
        severity: 'warn',
        message: `${business.overdue_accepted} طلب مقبول عدّى ميعاده والفني ما تحرّكش`,
      });
    }

    if (proc.memoryRssMb >= thresholds.memoryRssMb) {
      alerts.push({
        key: 'memory',
        severity: 'warn',
        message: `استهلاك الذاكرة ${proc.memoryRssMb}MB (الحد ${thresholds.memoryRssMb}MB)`,
      });
    }

    return alerts;
  }
}

function processSnapshot() {
  const mem = process.memoryUsage();
  const [load1, load5, load15] = os.loadavg();
  return {
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    cpuCount: os.cpus().length,
    loadAverage: { '1m': round2(load1), '5m': round2(load5), '15m': round2(load15) },
    /** الحمل لكل نواة — الرقم الخام مالوش معنى من غير عدد الأنوية. */
    loadPerCore: round2(load1 / Math.max(1, os.cpus().length)),
  };
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function worst(alerts: OpsAlert[]): OpsSeverity {
  if (alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (alerts.length > 0) return 'warn';
  return 'ok';
}

function snake(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
