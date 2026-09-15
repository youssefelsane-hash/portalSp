import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runExclusiveSweep } from '../../../common/db/sweep-lock';
import { RiskDetectorService } from './risk-detector.service';

/** كل ٦ ساعات: الإشارات دي أنماط على مدى شهور، فالرصد كل ساعة مايضيفش حاجة غير حمل. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** تأخير أول تشغيلة بعد الإقلاع — مايزاحمش بدء التطبيق. */
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

/**
 * جدولة كاشفات المخاطر (ADR-0085).
 *
 * **القفل الاستشاري (`runExclusiveSweep`) ضروري هنا مش تزيين**: الكاشفات بتكتب في
 * `risk_signals`، ونسختين بيشتغلوا مع بعض كانوا هيتسابقوا على نفس `dedupe_key`. القيد الفريد
 * بيمنع التكرار، بس النسخة الخاسرة كانت هترمي خطأ في اللوج كل ٦ ساعات بلا أي سبب حقيقي.
 *
 * **الفشل هنا مابيوقفش حاجة**: مركز المخاطر شاشة مراقبة، مش مسار في فلو العميل. أي وقوع
 * بيتسجّل تحذير والدورة الجاية بتعيد المحاولة — نفس قاعدة CLAUDE.md §2.
 */
@Injectable()
export class RiskDetectorScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RiskDetectorScheduler.name);
  private timer?: NodeJS.Timeout;
  private firstRunTimer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly detectors: RiskDetectorService,
  ) {}

  onModuleInit(): void {
    // في الاختبارات مابنشغّلش مؤقتات: سبيك بيختبر منطق تاني خالص مالوش دعوة يكتب إشارات مخاطر.
    if (process.env.NODE_ENV === 'test') return;

    this.firstRunTimer = setTimeout(() => void this.sweep(), FIRST_RUN_DELAY_MS);
    this.firstRunTimer.unref?.();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRunTimer) clearTimeout(this.firstRunTimer);
  }

  private async sweep(): Promise<void> {
    await runExclusiveSweep(
      this.dataSource,
      'risk-detectors',
      async () => {
        const results = await this.detectors.runAllDetectors();
        const written = results.reduce((sum, row) => sum + row.inserted, 0);
        const failed = results.filter((row) => row.error);
        this.logger.log(`كاشفات المخاطر: ${written} إشارة من ${results.length} كاشف` +
          (failed.length ? ` — ${failed.length} كاشف وقع` : ''));
        return written;
      },
      this.logger,
    );
  }
}
