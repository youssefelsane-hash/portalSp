import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { PaymentsService } from './payments.service';

// ADR-0015 — استماع مركزي نفس نمط ScheduleSlotReleaseListener بالحرف: لو طلب اتحول لـ
// WORK_COMPLETED، وكان مدفوع مسبقًا (كارت/InstaPay قبل التوزيع، ADR-0013)، لازم تسوية فورية —
// وإلا يفضل عالق للأبد (البَقّة الحرجة اللي ADR-0015 وثّقها). settleAlreadyPaidOrder() نفسها
// idempotent وآمنة تُنادى لأي طلب (بترجع فورًا لو مش الحالة دي)، فمفيش داعي فحص هنا غير newStatus.
@Injectable()
export class PrepaidOrderSettlementListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrepaidOrderSettlementListener.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly paymentsService: PaymentsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((error) =>
        this.logger.error('فشل فحص تسويات الطلبات المدفوعة مسبقًا', error instanceof Error ? error.stack : error),
      );
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  sweep(): Promise<number> {
    return this.paymentsService.reconcilePrepaidWorkCompleted(25);
  }

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (event.newStatus !== OrderStatus.WORK_COMPLETED) return;
    try {
      await this.paymentsService.settleAlreadyPaidOrder(event.orderId);
    } catch (err) {
      // لا نوقف بقية المستمعين؛ sweep قاعدة البيانات سيعيد بناء الحدث المفقود في دورة لاحقة.
      this.logger.error(
        `فشل تسوية طلب مدفوع مسبقًا ${event.orderId} بعد اكتمال الشغل — سيعاد تلقائيًا`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
