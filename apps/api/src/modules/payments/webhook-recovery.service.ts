import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { WebhookEvent, WebhookProcessingStatus } from './entities/webhook-event.entity';
import { PaymentsService } from './payments.service';

const SWEEP_INTERVAL_MS = 60_000;
const RECOVERY_BATCH_SIZE_FALLBACK = 25;
const PROCESSING_STALE_MINUTES_FALLBACK = 5;

/**
 * استرداد webhook المتوقف مستقل عن Redis/BullMQ عمداً: هذا مسار سلامة مالي، فلا يصح أن يعتمد
 * على worker قد يتوقف مع انقطاع Redis. أكثر من instance قد تفحص الصف نفسه، لكن claim الذري في
 * PaymentsService هو صاحب قرار من يعالجه فعلياً.
 */
@Injectable()
export class WebhookRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(WebhookEvent) private readonly webhookEvents: Repository<WebhookEvent>,
    private readonly settingsService: SettingsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error('فشل فحص استرداد webhooks', err instanceof Error ? err.stack : err));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const batchSize = Math.max(
      1,
      Math.floor(await this.settingsService.getNumber('payments.webhook_recovery_batch_size', RECOVERY_BATCH_SIZE_FALLBACK)),
    );
    const staleMinutes = Math.max(
      1,
      await this.settingsService.getNumber('payments.webhook_processing_stale_minutes', PROCESSING_STALE_MINUTES_FALLBACK),
    );
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);

    const candidates = await this.webhookEvents
      .createQueryBuilder('event')
      .select(['event.id'])
      .where('event.processingStatus = :failed AND event.nextRetryAt IS NOT NULL AND event.nextRetryAt <= :now', {
        failed: WebhookProcessingStatus.FAILED,
        now,
      })
      .orWhere('event.processingStatus = :processing AND event.processingStartedAt < :staleBefore', {
        processing: WebhookProcessingStatus.PROCESSING,
        staleBefore,
      })
      .orderBy('event.nextRetryAt', 'ASC', 'NULLS LAST')
      .take(batchSize)
      .getMany();

    for (const event of candidates) {
      try {
        await this.paymentsService.recoverWebhookEvent(event.id);
      } catch (err) {
        // finalizeGatewayWebhook يسجل FAILED + next_retry_at قبل أن يرمي؛ لا نكسر بقية الدفعة.
        this.logger.error(`فشل استرداد webhook ${event.id}`, err instanceof Error ? err.stack : err);
      }
    }

    if (candidates.length > 0) {
      this.logger.log(`استرداد webhooks: فُحصت ${candidates.length} محاولة قابلة للاسترجاع`);
    }
    return candidates.length;
  }
}
