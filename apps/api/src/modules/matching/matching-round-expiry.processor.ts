import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { In, Repository } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { AssignmentStatus, OrderAssignment } from './entities/order-assignment.entity';
import { MATCHING_ROUNDS_QUEUE, RoundExpiredJobData } from './matching-rounds.queue';
import { MatchingService } from './matching.service';

/**
 * بيتنفّذ لحظة انتهاء مهلة رد الفنيين على جولة (30 ثانية) — لو محدش رد صراحة (قبول/رفض)،
 * ده أول وآخر آلية بتحرّك الطلب في السيناريو ده (موبايل مقفول، تطبيق مقفول، ...). قبل كده
 * الطلب كان بيفضل عالق في searching_technician للأبد لو الفنيين تجاهلوا العرض من غير رفض صريح.
 */
@Processor(MATCHING_ROUNDS_QUEUE)
export class MatchingRoundExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingRoundExpiryProcessor.name);

  constructor(
    @InjectRepository(OrderAssignment) private readonly assignments: Repository<OrderAssignment>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly matchingService: MatchingService,
  ) {
    super();
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

    await this.matchingService.dispatchNextRound(orderId);
  }
}
