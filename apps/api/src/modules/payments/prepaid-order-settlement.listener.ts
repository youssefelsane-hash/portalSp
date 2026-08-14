import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { PaymentsService } from './payments.service';

// ADR-0015 — استماع مركزي نفس نمط ScheduleSlotReleaseListener بالحرف: لو طلب اتحول لـ
// WORK_COMPLETED، وكان مدفوع مسبقًا (كارت/InstaPay قبل التوزيع، ADR-0013)، لازم تسوية فورية —
// وإلا يفضل عالق للأبد (البَقّة الحرجة اللي ADR-0015 وثّقها). settleAlreadyPaidOrder() نفسها
// idempotent وآمنة تُنادى لأي طلب (بترجع فورًا لو مش الحالة دي)، فمفيش داعي فحص هنا غير newStatus.
@Injectable()
export class PrepaidOrderSettlementListener {
  private readonly logger = new Logger(PrepaidOrderSettlementListener.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (event.newStatus !== OrderStatus.WORK_COMPLETED) return;
    try {
      await this.paymentsService.settleAlreadyPaidOrder(event.orderId);
    } catch (err) {
      // مبيرميش استثناء يوقف بقية معالجة الحدث — نفس فلسفة onModuleInit's catch في
      // order-auto-cancel.service.ts. فشل هنا (DB عابر مثلاً) محتاج مراجعة يدوية، بس مايكسرش
      // تجربة الفني (الطلب فضل WORK_COMPLETED، مش عالق بصمت — الأدمن يقدر يشوفه).
      this.logger.error(
        `فشل تسوية طلب مدفوع مسبقًا ${event.orderId} بعد اكتمال الشغل — محتاج مراجعة يدوية`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
