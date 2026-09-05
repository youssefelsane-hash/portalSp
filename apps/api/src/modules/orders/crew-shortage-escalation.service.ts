import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { ORDER_CREW_SHORTAGE_ESCALATED_EVENT, OrderCrewShortageEscalatedEvent } from '../../common/events/order-crew-shortage-escalated.event';
import { SettingsService } from '../settings/settings.service';
import { BookingMode, Order, OrderStatus } from './entities/order.entity';
import { OrderTeamService, orderRequiresCrewBeyondLeader } from './order-team.service';

const SWEEP_INTERVAL_MS = 60_000;
// نفس SWEEP_BATCH_SIZE بالحرف زي OrderAutoCancelService/NotificationWorkflowReminderService —
// دفعة محدودة كل تيك بدل full-table scan، الباقي بياخد دوره في التيك اللي بعده.
const SWEEP_BATCH_SIZE = 25;
const ESCALATION_HOURS_BEFORE_FALLBACK = 24;
// طلبات الفريق قبل ما تبدأ التنفيذ فعليًا (IN_PROGRESS ممنوع أصلاً لو الطاقم ناقص — بوابة §35.1) —
// نطاق الحالات اللي "نقص الطاقم" فيها معنى عملي حقيقي (قائد اتعيّن، طاقم لسه بيتجمّع).
// مُصدَّرة (مش local بس) عشان AdminOperationsOverviewService (docs/08 §36.2) تعيد استخدامها
// بالظبط بدل ما تكرّر نفس القائمة — "نقص الطاقم لسه مفتوح تشغيليًا" لازم يفضل تعريف واحد.
export const ESCALATABLE_STATUSES = [
  OrderStatus.TECHNICIAN_ASSIGNED,
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
];

/**
 * تصعيد نقص طاقم قبل الموعد المجدول (docs/08 §35.5، ADR-0021) — فحص دوري (`setInterval`) بيعيد
 * التقييم من Postgres مباشرة كل مرة، بالظبط نفس قرار `OrderAutoCancelService`/
 * `NotificationWorkflowReminderService` (مفيش حالة متخزّنة في Redis ممكن "تعلق" بعد انقطاع طويل).
 *
 * **قرار تصميم متعمّد**: تصعيد لمرة واحدة بس لكل طلب (`orders.crew_shortage_escalated_at` —
 * migration 0156)، مش تذكير متكرر زي `NotificationWorkflowService` — طلب المالك كان "تنبيه قوي"
 * عند عبور عتبة الـ24 ساعة، مش نظام تذكيرات كامل بعتبات متعددة (ده هيتقيّم لاحقًا لو المالك طلبه
 * صراحة في §35.12 "تنبيهات عمليات" — نفس فلسفة عدم بناء نظام تذكير موازي من غير داعي حقيقي).
 * "الطلب مميّز بصريًا" (الجزء التاني من §35.5) محسوب وقت القراءة (`crewShortageUrgent` في
 * `AdminOrdersService.getDetail()`)، مش state مخزّن — نفس مبدأ ADR-0021 §5 (صفر تخزين حالة زيادة
 * عن اللازم لما نقدر نحسبها من البيانات الحقيقية وقت الطلب).
 */
@Injectable()
export class CrewShortageEscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrewShortageEscalationService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly orderTeamService: OrderTeamService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'crew-shortage-escalation', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const hoursBefore = await this.settingsService.getNumber(
      'orders.crew_shortage_escalation_hours_before',
      ESCALATION_HOURS_BEFORE_FALLBACK,
    );
    const now = new Date();
    const cutoff = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);

    // ADR-0064 §1 — الشرط بقى «الطلب محتاج طاقم زيادة عن القائد»، مش «وضع الحجز فريق».
    //
    // البَقّة اللي اتقفلت: طلب **فردي** محتاج مساعد (`required_assistants > 0`) كان بيتمنع من
    // البدء ببوابة `IN_PROGRESS` ومابيتصعّدش هنا أبدًا، لأن المسح كان بيدوّر على
    // `bookingMode = TEAM` بس. الفني متسكّر والإدارة مش عارفة. الشرط دلوقتي مطابق للبوابة بالحرف
    // (`orderRequiresCrewBeyondLeader`) — مصدر واحد للسؤال.
    const candidates = await this.orders
      .createQueryBuilder('o')
      .select(['o.id'])
      .where('o.order_status IN (:...statuses)', { statuses: ESCALATABLE_STATUSES })
      .andWhere('o.scheduled_at <= :cutoff', { cutoff })
      .andWhere('o.crew_shortage_escalated_at IS NULL')
      .andWhere(
        '(o.booking_mode = :team OR COALESCE(o.required_technicians, 1) > 1 OR COALESCE(o.required_assistants, 0) > 0)',
        { team: BookingMode.TEAM },
      )
      .orderBy('o.scheduled_at', 'ASC')
      .take(SWEEP_BATCH_SIZE)
      .getMany();

    let escalatedCount = 0;
    for (const { id } of candidates) {
      const escalated = await this.escalateIfStillIncomplete(id, now);
      if (escalated) escalatedCount++;
    }
    if (escalatedCount > 0) {
      this.logger.log(`تصعيد نقص الطاقم: ${escalatedCount} طلب اتصعّد للأدمن`);
    }
    return escalatedCount;
  }

  /**
   * **تصعيد فوري** لحظة ما نقص الطاقم يعطّل شغل حقيقي (ADR-0064 §1).
   *
   * المسح الدوري بيصعّد قبل الموعد بـ24 ساعة — تنبيه استباقي كويس، بس متأخر جدًا لما الفني يكون
   * **واقف على الباب دلوقتي** ومش قادر يبدأ. الدالة دي بتتنادى من البوابة نفسها، وبتستخدم
   * **نفس** مسار التصعيد والقفل والحدث (مش مسار موازي)، فالفرق الوحيد إنها مش مشروطة بوجود موعد.
   *
   * بتعتمد على نفس بوابة المرة الواحدة (`crew_shortage_escalated_at`)، فلو الفني دَس عشر مرات
   * الإدارة بتاخد إشعار واحد.
   */
  async escalateNow(orderId: string, reason: string): Promise<boolean> {
    const escalated = await this.escalateIfStillIncomplete(orderId, new Date(), false);
    if (escalated) {
      this.logger.warn(`تصعيد فوري لنقص طاقم على الطلب ${orderId} (${reason})`);
    }
    return escalated;
  }

  // قفل ذري لكل صف على حدة — نفس نمط OrderAutoCancelService.cancelIfStillPendingPayment().
  private async escalateIfStillIncomplete(orderId: string, now: Date, requireSchedule = true): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();

      // اتلغى/اتقدّم/اتصعّد بالفعل بين لحظة الاستعلام والقفل — safe no-op.
      if (
        !order ||
        order.crewShortageEscalatedAt ||
        !orderRequiresCrewBeyondLeader(order) ||
        !ESCALATABLE_STATUSES.includes(order.orderStatus) ||
        // التصعيد المجدول محتاج موعد يقيس عليه؛ التصعيد الفوري (`escalateNow`) مش محتاج، لأن
        // اللحظة نفسها هي الدليل. عشان كده الشرط ده هنا مش في `escalateIfIncomplete`.
        (requireSchedule && !order.scheduledAt)
      ) {
        return null;
      }

      const composition = await this.orderTeamService.getCrewComposition(order.id, order);
      if (composition.crewComplete) return null;

      order.crewShortageEscalatedAt = now;
      await manager.save(order);
      return { order, composition };
    });

    if (!result) return false;

    this.events.emit(
      ORDER_CREW_SHORTAGE_ESCALATED_EVENT,
      new OrderCrewShortageEscalatedEvent(
        result.order.id,
        result.order.orderNumber,
        // التصعيد الفوري ممكن يحصل لطلب ASAP بلا موعد — بنستخدم لحظة التصعيد نفسها كمرجع زمني
        // للإشعار بدل ما نكسر النوع بـ`as Date` على null.
        result.order.scheduledAt ?? now,
        result.composition.missingTechnicians,
        result.composition.missingAssistants,
      ),
    );
    return true;
  }
}
