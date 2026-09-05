import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampaignsService } from './campaigns.service';

/**
 * الدورة الدورية لمحرك الحملات (ADR-0046 §8).
 *
 * `setInterval` بـPostgres مباشرة — نفس فلسفة `ReferralRecoveryService`/`OrderAutoCancelService`
 * القايمة، **مش BullMQ**. السبب: ربط الإعلانات بصحة Redis بيضيف نقطة فشل لميزة تسويقية بلا أي
 * مقابل. لو Redis وقع، الإعلانات بتتأجّل بس ومفيش حاجة بتتكسر.
 *
 * 5 دقايق: التأخير الفعلي في «بعد ساعة من الاهتمام المتروك» بيبقى 60-65 دقيقة، وده مقبول
 * تمامًا لرسالة تسويقية.
 */
const SWEEP_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class CampaignSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly campaigns: CampaignsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): إشعار تسويقي بيتبعت مرة واحدة، مش مرة لكل instance.
      void runExclusiveSweep(
        this.dataSource,
        'campaign-sweep',
        async () => {
          const sent = await this.campaigns.sweep();
          if (sent > 0) this.logger.log(`محرك الحملات: اتبعت ${sent} إشعار تسويقي`);
        },
        this.logger,
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
