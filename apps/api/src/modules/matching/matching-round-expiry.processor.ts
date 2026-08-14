import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { In, Repository } from 'typeorm';
import { getRedisUrl } from '../../config/redis-url.util';
import { ORDER_OFFER_RESOLVED_EVENT, OrderOfferResolvedEvent } from '../../common/events/order-offer-resolved.event';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { AssignmentStatus, OrderAssignment } from './entities/order-assignment.entity';
import { MATCHING_ROUNDS_QUEUE, RoundExpiredJobData } from './matching-rounds.queue';
import { MatchingService } from './matching.service';

/**
 * بيتنفّذ لحظة انتهاء مهلة رد الفنيين على جولة (30 ثانية) — لو محدش رد صراحة (قبول/رفض)،
 * ده أول وآخر آلية بتحرّك الطلب في السيناريو ده (موبايل مقفول، تطبيق مقفول، ...). قبل كده
 * الطلب كان بيفضل عالق في searching_technician للأبد لو الفنيين تجاهلوا العرض من غير رفض صريح.
 */
// اتصال Redis منفصل عن اتصال الـ Queue (producer)، ممرَّر مباشرة (مش عن طريق configKey) — تفاصيل
// كاملة في technician-stats.processor.ts وREADME: @nestjs/bullmq بيتجاهل configKey تماماً لو فيه
// Queue متسجّل بنفس الاسم بالفعل (وهو موجود، في MatchingModule)، فالطريقة المضمونة الوحيدة هي
// override مباشر لـ connection هنا. enableOfflineQueue: false هنا مقصودة (مش نسيان) — راجع الشرح
// الكامل في technician-stats.processor.ts: enableOfflineQueue الافتراضي (true) بيخلي أوامر زي
// EVALSHA تتحجز صامتة للأبد لو الاتصال لسه مش ready فعلياً بعد انقطاع، بدل ما تترفض وتدخل مسار
// إعادة المحاولة بتاع BullMQ.
@Processor(
  { name: MATCHING_ROUNDS_QUEUE },
  {
    connection: {
      url: getRedisUrl(),
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    },
  },
)
export class MatchingRoundExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingRoundExpiryProcessor.name);

  constructor(
    @InjectRepository(OrderAssignment) private readonly assignments: Repository<OrderAssignment>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly matchingService: MatchingService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  // نفس سبب technician-stats.processor.ts بالظبط — لازم مستمع لـ 'error' وإلا Node بيرمي
  // الخطأ ده لما محدش مستمع، وده بيوقف mainLoop الداخلي بتاع BullMQ Worker بصمت للأبد.
  @OnWorkerEvent('error')
  handleWorkerError(error: Error): void {
    this.logger.warn(`Worker error (matching-rounds): ${error.message}`);
  }

  async process(job: Job<RoundExpiredJobData>): Promise<void> {
    const { orderId, round } = job.data;

    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN) {
      return; // الطلب اتحل (قبول/إلغاء) قبل ما المهلة تخلص — مفيش داعي نعمل حاجة
    }

    const staleAssignments = await this.assignments.find({
      where: { orderId, assignmentRound: round, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
    });
    if (staleAssignments.length === 0) {
      return; // كل عروض الجولة دي اتردّ عليها صراحة قبل المهلة (accept/reject) — مفيش حاجة معلّقة
    }

    const now = new Date();
    for (const assignment of staleAssignments) {
      assignment.assignmentStatus = AssignmentStatus.TIMEOUT;
      assignment.respondedAt = now;
    }
    await this.assignments.save(staleAssignments);
    this.logger.log(`جولة ${round} انتهت من غير رد لـ${staleAssignments.length} فني — طلب ${order.orderNumber}, بنبعت الجولة الجاية`);

    // docs/08 §17.16 — أي دورة تذكير critical_offer شغالة للعروض دي لازم توقف فورًا (idempotent،
    // safe no-op للعروض العادية اللي مالهاش workflow أصلاً).
    for (const assignment of staleAssignments) {
      this.events.emit(
        ORDER_OFFER_RESOLVED_EVENT,
        new OrderOfferResolvedEvent(assignment.id, orderId, order.orderNumber, assignment.technicianId, 'expired'),
      );
    }

    await this.matchingService.dispatchNextRound(orderId);
  }
}
