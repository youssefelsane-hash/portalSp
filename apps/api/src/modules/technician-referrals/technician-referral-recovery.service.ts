import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { TechnicianReferralsService } from './technician-referrals.service';

const SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class TechnicianReferralRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TechnicianReferralRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly technicianReferralsService: TechnicianReferralsService,
    private readonly settingsService: SettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) =>
        this.logger.error('فشل استرداد مكافآت ترشيح الفنيين', err instanceof Error ? err.stack : err),
      );
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<number> {
    const batchSize = Math.max(
      1,
      Math.floor(await this.settingsService.getNumber('referral.recovery_batch_size', 25)),
    );
    const processed = await this.technicianReferralsService.reconcilePendingBonuses(batchSize);
    if (processed > 0) {
      this.logger.log(`استرداد ترشيحات الفنيين: تمت مراجعة ${processed} طلب`);
    }
    return processed;
  }
}
