import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_QUOTE_ABOVE_RANGE_DECIDED_EVENT,
  OrderQuoteAboveRangeDecidedEvent,
} from '../../../common/events/order-quote-above-range-decided.event';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

function egp(amountCents: number): string {
  return (amountCents / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * ADR-0067 §1 — نتيجة مراجعة الأدمن لسعر خارج النطاق، بتروح للفني اللي **بعت العرض** (مش الفني
 * المعيّن على الطلب بالضرورة — العرض ممكن يكون من فني معاينة اتغيّر بعدها).
 *
 * مسار الرفض هو السبب الأساسي للـlistener ده: الأدمن بيرجّع `price_status` لـ`waiting_quote` من
 * غير أي انتقال حالة، يعني الفني مطلوب منه سعر جديد ومفيش حاجة كانت بتقوله. الرفض `action_required`
 * (فيه فعل مطلوب)، والاعتماد إشعار خبري.
 */
@Injectable()
export class OrderQuoteAboveRangeDecidedNotificationListener {
  private readonly logger = new Logger(OrderQuoteAboveRangeDecidedNotificationListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(ORDER_QUOTE_ABOVE_RANGE_DECIDED_EVENT)
  async handle(event: OrderQuoteAboveRangeDecidedEvent): Promise<void> {
    try {
      const deepLink = `/technician/orders/${event.orderId}`;
      const titleAr = event.approved ? 'الإدارة اعتمدت سعرك' : 'الإدارة رفضت السعر — محتاجين سعر جديد';
      const bodyAr = event.approved
        ? `طلب رقم ${event.orderNumber}: سعر ${egp(event.amountCents)} ج.م اتعتمد وراح للعميل للموافقة.`
        : `طلب رقم ${event.orderNumber}: سعر ${egp(event.amountCents)} ج.م اترفض — ${event.reason}. ابعت سعر جديد من تفاصيل الطلب.`;

      const workflow = event.approved
        ? null
        : await this.workflowService.create({
            userId: event.submittedByUserId,
            notificationType: 'order_quote_above_range_rejected',
            titleAr,
            bodyAr,
            entityType: 'order',
            entityId: event.orderId,
            deepLink,
            actionType: 'resubmit_quote',
          });

      await this.notificationsService.notifyMultiChannel(
        {
          userId: event.submittedByUserId,
          notificationType: event.approved
            ? 'order_quote_above_range_approved'
            : 'order_quote_above_range_rejected',
          titleAr,
          bodyAr,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink,
          workflowId: workflow?.id,
        },
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );
    } catch (err) {
      this.logger.error(
        `فشل إشعار قرار السعر الخارج عن النطاق للطلب ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
