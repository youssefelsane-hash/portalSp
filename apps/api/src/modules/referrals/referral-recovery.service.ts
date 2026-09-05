import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { ReferralsService } from './referrals.service';

const SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class ReferralRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly referralsService: ReferralsService,
    private readonly settingsService: SettingsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'referral-recovery', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const batchSize = Math.min(100, Math.max(
      1,
      Math.floor(await this.settingsService.getNumber('referral.recovery_batch_size', 25)),
    ));
    const processed = await this.referralsService.reconcilePending(batchSize);
    if (processed > 0) this.logger.log(`استرداد الترشيحات: تمت مراجعة ${processed} إحالة معلقة`);
    return processed;
  }
}
