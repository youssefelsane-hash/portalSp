import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import { OrderStatus } from '../../orders/entities/order.entity';
import { TechnicianReferralsService } from '../technician-referrals.service';

const REVOKING_STATUSES = new Set<OrderStatus>([
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
  OrderStatus.REFUNDED,
]);

// يقيّم استحقاق مكافأة ترشيح QR الفني عند وصول الطلب لعتبة قابلة للإعداد (docs/11 §1)، ويلغيها
// لو الطلب اتلغى/استُرد بعد ما المكافأة اتحسبت بالفعل.
@Injectable()
export class TechnicianReferralOrderStatusListener {
  private readonly logger = new Logger(TechnicianReferralOrderStatusListener.name);

  constructor(private readonly referralsService: TechnicianReferralsService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handle(event: OrderStatusChangedEvent): Promise<void> {
    try {
      if (REVOKING_STATUSES.has(event.newStatus)) {
        await this.referralsService.revokeBonusForOrder(event.orderId, `الطلب أصبح ${event.newStatus}`);
        return;
      }
      await this.referralsService.evaluateOrderForBonus(event.orderId, event.newStatus);
    } catch (err) {
      // فشل تقييم/إلغاء مكافأة الترشيح مايكسرش تدفق الطلب الحقيقي
      this.logger.error(`فشل معالجة مكافأة ترشيح للطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
