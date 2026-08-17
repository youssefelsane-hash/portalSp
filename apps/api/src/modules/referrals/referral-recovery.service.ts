import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) =>
        this.logger.error('فشل استرداد أحداث الترشيح', err instanceof Error ? err.stack : err),
      );
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
