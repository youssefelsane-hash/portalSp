import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { TechnicianScheduleService } from './technician-schedule.service';

const RELEASE_SLOT_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
  OrderStatus.SEARCHING_TECHNICIAN,
  OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
];

// الجدولة الحقيقية للفني (docs/08 §2-§3) — لو طلب محجوز اتلغى أو رجع لاختيار فني آخر، السلوت
// لازم يرجع "متاح" فورًا بدل ما يفضل "محجوز" أبديًا لطلب لم يعد مرتبطًا بهذا الفني —
// وإلا الفني بيفقد الوقت ده للأبد من غير أي طلب حقيقي شغال عليه. نفس نمط
// TechnicianStatsRecalculationListener بالحرف (استماع مركزي لـORDER_STATUS_CHANGED_EVENT بدل
// ما نضيف نداء يدوي في كل مكان بيلغي طلب — 4 أماكن مختلفة: cancel/technicianCancel/admin/auto-cancel).
// releaseSlotForOrder() نفسها idempotent (UPDATE ... WHERE order_id=X بس) — استدعاؤها لطلب
// مالوش سلوت أصلاً (الحالة الشائعة) no-op آمن تمامًا، صفر أثر جانبي.
@Injectable()
export class ScheduleSlotReleaseListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleSlotReleaseListener.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly scheduleService: TechnicianScheduleService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'schedule-slot-release', () => this.sweep(), this.logger);
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  sweep(): Promise<number> {
    return this.scheduleService.reconcileReleasedSlots(25);
  }

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (!RELEASE_SLOT_STATUSES.includes(event.newStatus)) return;
    await this.scheduleService.releaseSlotForOrder(event.orderId);
  }
}
