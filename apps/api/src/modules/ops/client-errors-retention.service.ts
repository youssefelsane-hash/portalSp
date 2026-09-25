import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { ClientErrorsService } from './client-errors.service';

/**
 * **تنظيف أخطاء الواجهة القديمة** (ADR-0114).
 *
 * ليه خدمة لوحدها مش سطر جوّه `QueueWatchdogService`: الـwatchdog بيتعطّل بمفتاح إعدادات
 * (`ops.queue_watchdog_enabled`)، ولو التنظيف كان جواه كان **بيتوقف معاه بالصدفة** — وجدول
 * بيكبر بلا حد بيبقى هو نفسه مشكلة مراقبة. الدورة يومية والقفل استشاري، فأي عدد instances
 * بيعمل التنظيف مرة واحدة.
 */
@Injectable()
export class ClientErrorsRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClientErrorsRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly clientErrors: ClientErrorsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), 24 * 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    const days = await this.settings.getNumber('ops.client_errors_retention_days', 30);
    await runExclusiveSweep(
      this.dataSource,
      'client-errors-retention',
      async () => {
        const deleted = await this.clientErrors.purge(days);
        if (deleted > 0) this.logger.log(`اتشال ${deleted} خطأ واجهة أقدم من ${days} يوم`);
      },
      this.logger,
    );
  }
}
