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
 * بيتنفّذ لحظة انتهاء "مهلة رد" جولة (30 ثانية للعادي، أقصر للطوارئ) — لو محدش رد صراحة
 * (قبول/رفض)، ده أول وآخر آلية بتحرّك الطلب في السيناريو ده (موبايل مقفول، تطبيق مقفول، ...).
 * قبل كده الطلب كان بيفضل عالق في searching_technician للأبد لو الفنيين تجاهلوا العرض من غير
 * رفض صريح.
 *
 * **تصحيح جوهري (ADR-0018 §5، طلب صريح من المالك 2026-08-19)**: بعد ADR-0018 §3-4-6، الجولات
 * دي (dispatchNextRound/accept/reject) بقت **حصرًا لطلبات الطوارئ** (المجدول بيتأكد تلقائيًا
 * فورًا بلا جولات خالص). طلب الطوارئ لازم **يفضل صالح للقبول طالما محدش قبله لسه** — مش زي
 * طلب Uber بينتهي بعد ثواني. قبل التصحيح ده، انتهاء المهلة كان بيحوّل عروض الجولة لـTIMEOUT
 * (بتختفي من `listAvailableForTechnician()` وبيترفضها `accept()`)، يعني أول فني اتبعتله
 * العرض بيفقد حقه في القبول لمجرد إن الجولة "التالية" بدأت — رغم إن الطلب لسه من غير فني.
 * الإصلاح: **مفيش لمس لحالة الـassignments خالص هنا**. `expiresAt` بقى معناها "امتى نوسّع
 * البث لفنيين إضافيين" بس، مش "امتى العرض بيبقى باطل" — العرض يفضل `sent` (قابل للقبول) لحد
 * ما فني تاني يقبل (`accept()` بتلغي كل العروض التانية وقتها فورًا، exclusivity ذرّية) أو
 * الفني ده نفسه يرفض صراحة (`reject()`). النداء التاني لـ`dispatchNextRound()` تحت بيوسّع
 * الدفعة لفنيين جداد بس، بلا ما يمس عروض الجولات اللي فاتت. `workflowService.resolve()` (في
 * OrderOfferResolutionListener، مستمع لـORDER_OFFER_RESOLVED_EVENT تحت) لسه بيوقف دورة تذكير
 * critical_offer المتكررة لهذا العرض بالذات (تجنّب إزعاج فني ساكت للأبد) — ده تنظيف إشعارات بس،
 * مالوش أي تأثير على جدول order_assignments أو قابلية القبول.
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

    // العروض المعلّقة (سواء اتشافت أو لأ) بتفضل sent/viewed زي ما هي — قابلة للقبول لحد ما فني
    // تاني ياخد الطلب أو الفني ده يرفض صراحة (ADR-0018 §5 فوق). بنجيبها هنا بس عشان نوقف دورة
    // التذكير المتكررة ليها (مش عشان نبطّلها).
    const stillPending = await this.assignments.find({
      where: { orderId, assignmentRound: round, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
    });
    if (stillPending.length === 0) {
      return; // كل عروض الجولة دي اتردّ عليها صراحة قبل المهلة (accept/reject) — مفيش حاجة معلّقة
    }

    this.logger.log(`جولة ${round} انتهت مهلتها من غير رد لـ${stillPending.length} فني — طلب ${order.orderNumber}, بنوسّع البث`);

    // docs/08 §17.16 — دورة تذكير critical_offer المتكررة لهذا العرض بالذات توقف (مش العرض
    // نفسه — لسه sent وقابل للقبول). notification_workflows بس هو اللي بيتأثر هنا، مالوش أي
    // علاقة بجدول order_assignments.
    for (const assignment of stillPending) {
      this.events.emit(
        ORDER_OFFER_RESOLVED_EVENT,
        new OrderOfferResolvedEvent(assignment.id, orderId, order.orderNumber, assignment.technicianId, 'expired'),
      );
    }

    // بيوسّع البث لدفعة فنيين إضافية (nextRound) — العروض القديمة فوق فضلت sent زي ما هي بلا
    // أي لمسة، أول فني (قديم أو جديد) يقبل ياخد الطلب (exclusivity ذرّية في accept()).
    await this.matchingService.dispatchNextRound(orderId);
  }
}
