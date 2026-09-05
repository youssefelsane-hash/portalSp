import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // نفس القاعدة: الـcallback يرجّع void، و`void` بتعلن إن الإطلاق-والنسيان مقصود
    // والرفض متعامل معاه بالـ.catch اللي جنبه.
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'technician-referral-recovery', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<number> {
    const batchSize = Math.min(100, Math.max(
      1,
      Math.floor(await this.settingsService.getNumber('referral.recovery_batch_size', 25)),
    ));
    const processed = await this.technicianReferralsService.reconcilePendingBonuses(batchSize);
    if (processed > 0) {
      this.logger.log(`استرداد ترشيحات الفنيين: تمت مراجعة ${processed} طلب`);
    }
    return processed;
  }
}
