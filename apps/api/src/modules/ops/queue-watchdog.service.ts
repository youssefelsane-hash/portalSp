import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SettingsService } from '../settings/settings.service';
import { MATCHING_ROUNDS_QUEUE } from '../matching/matching-rounds.queue';
import { ASSISTANT_MATCHING_QUEUE } from '../assistant-matching/assistant-matching.queue';
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
 * رغم إن Redis نفسه متاح ومتجاوَب") وبيسلّم قرار "استعادة الخدمة" لـsupervisor خارجي (systemd،
 * `infra/systemd/baytak-api.service` — `Restart=always`).
 *
 * **ليه فحص "وظيفة واقفة + Redis متاح" تحديدًا مش أي حاجة تانية**: ده بالظبط توقيع البَقّة
 * الموثّقة — الطابور فيه وظايف (`queue.add()` نجح، الإنتاج شغال زي ما هو موثّق)، Redis نفسه
 * شغال (PING بيرجّع PONG)، بس الـWorker مش بيسحب أي حاجة. لو Redis نفسه واقع، ده مش نفس البَقّة
 * (انقطاع عادي، الـWorker هيرجع يشتغل لوحده لما Redis يرجع — مفيش داعي لـrestart).
 *
 * ## تدرّج الخطورة (تدقيق C-1) — ليه مش كل طابور يستاهل إسقاط الـprocess
 *
 * النسخة الأولى كانت بتعامل التلات طوابير بنفس الخطورة: أي واحد فيهم يعلّق ⇒ `process.exit(1)`
 * فورًا. النتيجة إن **تعليق طابور تجميلي بالكامل كان بيسقّط الـAPI كله** — `customer_stats`
 * (إعادة حساب `totalOrdersCount` للعرض) يعلّق خمس دقايق، فعميل في نص `payWithWallet` وفني في نص
 * `collectCash` ياخدوا connection reset، وطلب طوارئ في نص التوزيع يتعلّق لحد ما الـprocess يرجع.
 * ده علاج أخطر من المرض: بنستبدل "إحصائية متأخرة" بـ"انقطاع خدمة".
 *
 * القسمة دلوقتي بمعيار واحد صريح: **هل تعليق الطابور ده بيسيب طلب حقيقي بلا حد يشتغل عليه؟**
 *   • `DISPATCH_CRITICAL` — أيوه. `matching-rounds` (توزيع الطلب على الفنيين) و`assistant-matching`
 *     (تجميع طاقم لطلب محتاج مساعد). تعليق أي منهم = عميل مستني ومحدش رايح له، والـrestart أرخص
 *     من الاستنى. دول بس اللي بيستاهلوا إعادة تشغيل.
 *   • `DEFERRED` — لأ. `customer-stats`/`technician-stats` إعادة حساب أرقام معروضة؛ تأخيرها بيغلط
 *     رقم على شاشة، مش بيوقف شغل. بتتسجّل `error` صريح (مراقبة/تنبيه بتلتقطه) والـprocess يفضل
 *     شغّال.
 *
 * **`assistant-matching` كان خارج المراقبة أصلاً (تدقيق C-2)** — أربع طوابير مسجّلة والـwatchdog
 * كان حاقن تلاتة. الطابور الرابع هو الأحدث (أقل اختبارًا) وتعليقه بيسيب طلب فريق معلّق للأبد،
 * فالحماية اللي اتبنت مخصوص للحالة دي كانت عمياها عنه. القايمة دلوقتي `WATCHED_QUEUES` واحدة
 * ومصنّفة، فأي طابور جديد بيتضاف لها بسطر واحد ومعاه تصنيفه إجباريًا (النوع بيفرض ده).
 *
 * ## إغلاق نظيف بدل قتل فوري (تدقيق S-2)
 *
 * `process.exit(1)` الخام كان بيقتل الـprocess في نص أي طلب جاري: Postgres بيعمل rollback
 * فمفيش فساد بيانات، بس المستخدم بيشوف فشل شبكة خام. دلوقتي بنبعت `SIGTERM` لنفسنا — و
 * `app.enableShutdownHooks()` (main.ts) بيحوّلها لإغلاق NestJS كامل: السيرفر بيبطّل يقبل طلبات
 * جديدة، الطلبات الجارية بتخلص، و`onModuleDestroy` بتقفل اتصالات DB/Redis نظيف. لو الإغلاق نفسه
 * علّق (اتصال عالق)، `forceExitTimer` بيقطعها بعد مهلة قصيرة عشان مانستبدلش تعليق بتعليق.
 * `Restart=always` بيعيد التشغيل أيًا كان كود الخروج، فالنتيجة النهائية زي ما كانت بالظبط بس
 * من غير ما نقطع شغل حقيقي في نصّه.
 */

/** تعليق الطابور ده بيسيب طلب حقيقي بلا حد يشتغل عليه ⇒ يستاهل إعادة تشغيل الـprocess. */
const DISPATCH_CRITICAL = 'dispatch_critical' as const;
/** تعليقه بيأخّر رقم معروض بس ⇒ تنبيه من غير إسقاط خدمة. */
const DEFERRED = 'deferred' as const;
type QueueTier = typeof DISPATCH_CRITICAL | typeof DEFERRED;

const SHUTDOWN_GRACE_SECONDS_FALLBACK = 10;

@Injectable()
export class QueueWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueWatchdogService.name);
  private timer?: NodeJS.Timeout;
  private forceExitTimer?: NodeJS.Timeout;
  /** إعادة التشغيل بتتطلب مرة واحدة بس — التيك اللي بعده أثناء مهلة الإغلاق مايكررش الطلب. */
  private restartRequested = false;

  private readonly watchedQueues: { queue: Queue; tier: QueueTier }[];

  constructor(
    @InjectQueue(MATCHING_ROUNDS_QUEUE) roundsQueue: Queue,
    @InjectQueue(ASSISTANT_MATCHING_QUEUE) assistantMatchingQueue: Queue,
    @InjectQueue(CUSTOMER_STATS_QUEUE) customerStatsQueue: Queue,
    @InjectQueue(TECHNICIAN_STATS_QUEUE) technicianStatsQueue: Queue,
    private readonly settings: SettingsService,
  ) {
    this.watchedQueues = [
      { queue: roundsQueue, tier: DISPATCH_CRITICAL },
      { queue: assistantMatchingQueue, tier: DISPATCH_CRITICAL },
      { queue: customerStatsQueue, tier: DEFERRED },
      { queue: technicianStatsQueue, tier: DEFERRED },
    ];
  }

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
    if (this.forceExitTimer) clearTimeout(this.forceExitTimer);
  }

  async checkAllQueues(): Promise<void> {
    // طابور واحد معلّق مايمنعش فحص الباقي — كل واحد بيتقيّم لوحده عشان تقرير الحالة يبقى كامل.
    for (const { queue, tier } of this.watchedQueues) {
      if (this.restartRequested) return;
      await this.checkQueue(queue, tier);
    }
  }

  // ملحوظة تصميم مهمة: مفيش PING منفصل هنا — `queue.getWaiting()` نفسها لو نجحت يبقى ده إثبات
  // كافي إن Redis متاح فعلاً (القراءة دي بتعدّي عليه)، ومفيش داعي لوصول مباشر لـ redis client
  // الداخلي بتاع الـQueue (backend abstraction جديدة في النسخة دي مش بتعرّضه أصلاً كـpublic API).
  // التحقيق الموثّق في technicians/README.md أكّد إن اتصال الـQueue (producer) مش هو المتأثر
  // بالبَقّة أصلاً — العلة في اتصال الـWorker (blocking connection) اللي مفيش وصول ليه من هنا.
  private async checkQueue(queue: Queue, tier: QueueTier): Promise<void> {
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

    const symptom =
      `طابور ${queue.name} فيه وظيفة واقفة ${waitingMinutes.toFixed(1)} دقيقة رغم إن Redis متاح ` +
      `(getWaiting نجحت فعلاً وقت الفحص ده) — نفس عرض بَقّة BullMQ #4479 الموثّقة (technicians/README.md).`;

    if (tier === DEFERRED) {
      // تجميلي: بنسجّل بصوت عالي عشان المراقبة تلتقطه، بس عمرنا ما نسقّط الخدمة عشانه.
      this.logger.error(
        `${symptom} الطابور ده مصنّف DEFERRED (إعادة حساب أرقام معروضة) — الأرقام هتتأخر، ` +
          `مفيش شغل واقف، والـprocess بيفضل شغّال عمدًا. لو الحالة استمرت، ده تدخّل يدوي مش إعادة تشغيل.`,
      );
      return;
    }

    this.logger.error(
      `CRITICAL: ${symptom} الطابور ده مصنّف DISPATCH_CRITICAL (طلب حقيقي مستني حد يشتغل عليه) — ` +
        `بيتعمل إغلاق رشيق عشان الـsupervisor الخارجي (infra/systemd/baytak-api.service) يعيد تشغيل الـprocess.`,
    );
    await this.requestGracefulRestart();
  }

  /**
   * `SIGTERM` لنفسنا بدل `process.exit()` — بيدخل على نفس مسار الإغلاق الرشيق اللي
   * `app.enableShutdownHooks()` مركّبه (وقف قبول طلبات جديدة ← إنهاء الجاري ← `onModuleDestroy`)،
   * والمهلة القصيرة بعدها شبكة أمان لو الإغلاق نفسه علّق.
   */
  private async requestGracefulRestart(): Promise<void> {
    if (this.restartRequested) return;
    this.restartRequested = true;

    const graceSeconds = await this.settings.getNumber(
      'ops.queue_watchdog_shutdown_grace_seconds',
      SHUTDOWN_GRACE_SECONDS_FALLBACK,
    );
    this.forceExitTimer = setTimeout(() => {
      this.logger.error(`الإغلاق الرشيق مخلّصش خلال ${graceSeconds} ثانية — خروج قسري.`);
      process.exit(1);
    }, graceSeconds * 1000);
    this.forceExitTimer.unref();

    process.kill(process.pid, 'SIGTERM');
  }
}
