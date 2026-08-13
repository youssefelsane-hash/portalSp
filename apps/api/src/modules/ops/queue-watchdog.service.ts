import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SettingsService } from '../settings/settings.service';
import { MATCHING_ROUNDS_QUEUE } from '../matching/matching-rounds.queue';
import { MATCHING_DISPATCH_QUEUE } from '../matching/matching-dispatch.queue';
import { CUSTOMER_STATS_QUEUE } from '../customers/customer-stats.queue';
import { TECHNICIAN_STATS_QUEUE } from '../technicians/technician-stats.queue';

/**
 * الجزء الأول (in-process detection) من خطة "supervisor/health-check/restart" اللي وعدنا بيها في
 * apps/api/src/modules/technicians/README.md لإغلاق فجوة "الـWorker مبيرجّعش يعالج وظايف جديدة
 * بعد انقطاع Redis طويل" (مطابقة لـ BullMQ issue #4479 — تحقيق كامل موثّق هناك، 3 محاولات إصلاح
 * من جوّه كود التطبيق فشلت، السبب في المكتبة نفسها).
 *
 * **الفلسفة**: بعد التحقيق، اتأكد إن مفيش طريقة نصلح الـWorker العالق من *جوّه* نفس الـprocess —
 * فبدل ما نحاول (تاني)، الـwatchdog ده بيكتشف الحالة بس ("فيه وظيفة واقفة في الطابور فترة طويلة
 * رغم إن Redis نفسه متاح ومتجاوَب") ويعمل `process.exit(1)` نظيف فورًا. القرار الفعلي "استعادة
 * الخدمة" منقول بالكامل لـsupervisor خارجي (systemd، `infra/systemd/baytak-api.service` —
 * `Restart=always`) بيعيد تشغيل الـprocess تلقائيًا خلال ثواني. نفس مبدأ "مايكسرش العملية
 * الحقيقية للمستخدم" لكن مطبّق هنا على مستوى العملية كلها مش طلب واحد.
 *
 * **ليه فحص "وظيفة واقفة + Redis متاح" تحديدًا مش أي حاجة تانية**: ده بالظبط توقيع البَقّة
 * الموثّقة — الطابور فيه وظايف (`queue.add()` نجح، الإنتاج شغال زي ما هو موثّق)، Redis نفسه
 * شغال (PING بيرجّع PONG)، بس الـWorker مش بيسحب أي حاجة. لو Redis نفسه واقع، ده مش نفس البَقّة
 * (انقطاع عادي، الـWorker هيرجع يشتغل لوحده لما Redis يرجع — مفيش داعي لـrestart).
 */
@Injectable()
export class QueueWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueWatchdogService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectQueue(MATCHING_ROUNDS_QUEUE) private readonly roundsQueue: Queue,
    @InjectQueue(MATCHING_DISPATCH_QUEUE) private readonly dispatchQueue: Queue,
    @InjectQueue(CUSTOMER_STATS_QUEUE) private readonly customerStatsQueue: Queue,
    @InjectQueue(TECHNICIAN_STATS_QUEUE) private readonly technicianStatsQueue: Queue,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = await this.settings.getBoolean('ops.queue_watchdog_enabled', true);
    if (!enabled) {
      this.logger.log('queue watchdog متعطّل عبر الإعدادات (ops.queue_watchdog_enabled=false)');
      return;
    }
    const intervalMinutes = await this.settings.getNumber('ops.queue_watchdog_check_interval_minutes', 2);
    this.timer = setInterval(() => {
      this.checkAllQueues().catch((err) => this.logger.warn(`فحص watchdog فشل (هيتحاول تاني بعد كده): ${err}`));
    }, intervalMinutes * 60_000);
    this.timer.unref(); // مايمنعش الـprocess من الخروج الطبيعي (shutdown/tests)
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async checkAllQueues(): Promise<void> {
    for (const queue of [this.roundsQueue, this.dispatchQueue, this.customerStatsQueue, this.technicianStatsQueue]) {
      await this.checkQueue(queue);
    }
  }

  // ملحوظة تصميم مهمة: مفيش PING منفصل هنا — `queue.getWaiting()` نفسها لو نجحت يبقى ده إثبات
  // كافي إن Redis متاح فعلاً (القراءة دي بتعدّي عليه)، ومفيش داعي لوصول مباشر لـ redis client
  // الداخلي بتاع الـQueue (backend abstraction جديدة في النسخة دي مش بتعرّضه أصلاً كـpublic API).
  // التحقيق الموثّق في technicians/README.md أكّد إن اتصال الـQueue (producer) مش هو المتأثر
  // بالبَقّة أصلاً — العلة في اتصال الـWorker (blocking connection) اللي مفيش وصول ليه من هنا.
  private async checkQueue(queue: Queue): Promise<void> {
    let oldestWaiting;
    try {
      [oldestWaiting] = await queue.getWaiting(0, 0);
    } catch (err) {
      this.logger.warn(`طابور ${queue.name}: تعذّر الاتصال بـ Redis وقت الفحص (${err}) — انقطاع عادي، مش عرض البَقّة الموثّقة. مفيش إجراء.`);
      return;
    }
    if (!oldestWaiting) return;

    const waitingMinutes = (Date.now() - oldestWaiting.timestamp) / 60_000;
    const thresholdMinutes = await this.settings.getNumber('ops.queue_watchdog_stall_threshold_minutes', 5);
    if (waitingMinutes < thresholdMinutes) return;

    this.logger.error(
      `CRITICAL: طابور ${queue.name} فيه وظيفة واقفة ${waitingMinutes.toFixed(1)} دقيقة رغم إن Redis متاح ` +
        `(getWaiting نجحت فعلاً وقت الفحص ده) — نفس عرض بَقّة BullMQ #4479 الموثّقة (technicians/README.md). ` +
        `بيتعمل exit نظيف عشان الـsupervisor الخارجي (infra/systemd/baytak-api.service) يعيد تشغيل الـprocess.`,
    );
    process.exit(1);
  }
}
