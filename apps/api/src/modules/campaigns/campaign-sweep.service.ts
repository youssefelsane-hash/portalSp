import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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

  constructor(private readonly campaigns: CampaignsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.campaigns
        .sweep()
        .then((sent) => {
          if (sent > 0) this.logger.log(`محرك الحملات: اتبعت ${sent} إشعار تسويقي`);
        })
        // أي فشل هنا بيتلقّط ويتسجّل بس — ميقدرش يوقّع الـprocess ولا يأثر على أي مسار حقيقي.
        .catch((err) => this.logger.error('فشلت دورة الحملات', err instanceof Error ? err.stack : err));
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
