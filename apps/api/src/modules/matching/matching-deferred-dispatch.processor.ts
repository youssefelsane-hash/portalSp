import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { getRedisUrl } from '../../config/redis-url.util';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { DeferredDispatchJobData, MATCHING_DISPATCH_QUEUE } from './matching-dispatch.queue';
import { MatchingService } from './matching.service';

/**
 * بيتنفّذ لحظة ما وقت البث الفعلي المؤجّل يوصل لطلب مجدول "بعيد" (ADR-0009 بند 1-2، P0-9) —
 * OrderDispatchListener بيجدول الـ job ده بدل ما ينادي dispatchNextRound() فورًا، لو الطلب فيه
 * scheduled_at بعيد عن دلوقتي أكتر من matching.deferred_dispatch_lead_hours ومفيش schedule_slot_id
 * صريح. لحد هنا الطلب كان محفوظ SEARCHING_TECHNICIAN من لحظة الإنشاء (العميل شايف "بندوّرلك على
 * فني" وده صحيح) بس مفيش أي OrderAssignment اتعمل ولا إشعار "طلب جديد" وصل لأي فني لحد الوقت ده.
 */
@Processor(
  { name: MATCHING_DISPATCH_QUEUE },
  {
    connection: {
      url: getRedisUrl(),
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    },
  },
)
export class MatchingDeferredDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingDeferredDispatchProcessor.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly matchingService: MatchingService,
  ) {
    super();
  }

  // نفس سبب matching-round-expiry.processor.ts بالظبط — مستمع 'error' إجباري وإلا Node بيوقف
  // mainLoop الداخلي بتاع BullMQ Worker بصمت للأبد لو حصل خطأ اتصال عابر.
  @OnWorkerEvent('error')
  handleWorkerError(error: Error): void {
    this.logger.warn(`Worker error (matching-dispatch): ${error.message}`);
  }

  async process(job: Job<DeferredDispatchJobData>): Promise<void> {
    const { orderId } = job.data;

    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN) {
      return; // اتلغى أو اتحل بطريقة تانية قبل ما وقت البث المؤجّل يوصل — مفيش داعي نعمل حاجة
    }

    this.logger.log(`وقت البث المؤجّل وصل — طلب ${order.orderNumber}, بنبدأ أول جولة مطابقة`);
    await this.matchingService.dispatchNextRound(orderId);
  }
}
