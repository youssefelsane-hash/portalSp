import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { getRedisUrl } from '../../config/redis-url.util';
import { AssistantMatchingService } from './assistant-matching.service';
import { ASSISTANT_MATCHING_QUEUE, AssistantOffersExpiredJobData } from './assistant-matching.queue';

/**
 * بيتنفّذ لحظة انتهاء مهلة رد المساعدين على بث المطابقة — نفس نمط MatchingRoundExpiryProcessor
 * بالحرف (اتصال Redis منفصل مباشر override، enableOfflineQueue:false، مستمع 'error' إجباري —
 * التفاصيل والمبررات الكاملة موثّقة في matching/matching-round-expiry.processor.ts، مش هتتكرر هنا).
 */
@Processor(
  { name: ASSISTANT_MATCHING_QUEUE },
  {
    connection: {
      url: getRedisUrl(),
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    },
  },
)
export class AssistantOfferExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(AssistantOfferExpiryProcessor.name);

  constructor(private readonly assistantMatchingService: AssistantMatchingService) {
    super();
  }

  @OnWorkerEvent('error')
  handleWorkerError(error: Error): void {
    this.logger.warn(`Worker error (assistant-matching): ${error.message}`);
  }

  async process(job: Job<AssistantOffersExpiredJobData>): Promise<void> {
    await this.assistantMatchingService.handleExpiry(job.data.orderId);
  }
}
