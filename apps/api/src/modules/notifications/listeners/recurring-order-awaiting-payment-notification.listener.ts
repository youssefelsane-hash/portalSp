import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  RECURRING_ORDER_AWAITING_PAYMENT_EVENT,
  RecurringOrderAwaitingPaymentEvent,
} from '../../../common/events/recurring-order-awaiting-payment.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import {
  PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT,
  PaymentInstaPayTransferReportedEvent,
} from '../../../common/events/payment-instapay-transfer-reported.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { OrderStatus } from '../../orders/entities/order.entity';
import { formatCairoDateTime } from '../../orders/recurring-occurrence-notice.util';
import { RECURRING_PAYMENT_REMINDER_ACTION } from '../../orders/recurring-payment-deadline.util';
import { orderRef } from '../notification-format.util';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

/**
 * دورة دفع النوبة المتكررة اليدوية (docs/08 §189 بند D-1، ADR-0116): إشعار فوري بالميعاد الحقيقي،
 * وتذكيرات من محرك الـworkflows الحالي (`recurring_order_payment_reminder`، scheduled_job نسبةً
 * للميعاد) — تذكير بعد مدة وتذكير أخير قبله. التذكيرات بتتحل هنا بالأحداث، ومعاها reconciliation
 * في `RecurringOrdersService.sweep()` كشبكة أمان.
 *
 * كله fire-and-forget آمن: فشل الإشعار مايرجّعش التوليد ولا يكسر حاجة.
 */
@Injectable()
export class RecurringOrderAwaitingPaymentNotificationListener {
  private readonly logger = new Logger(RecurringOrderAwaitingPaymentNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(RECURRING_ORDER_AWAITING_PAYMENT_EVENT)
  async handleRecurringOrderAwaitingPayment(event: RecurringOrderAwaitingPaymentEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const deepLink = `/orders/${event.orderId}`;
      const deadline = event.paymentDeadlineAt;
      const when = event.scheduledAt ? ` موعدها ${formatCairoDateTime(event.scheduledAt)}` : '';

      // نوبة قديمة بلا ميعاد متخزّن ⇒ نفس الإشعار القديم بالظبط ومن غير تذكيرات.
      const workflow = deadline
        ? await this.workflowService.create({
            userId: customer.userId,
            notificationType: 'recurring_order_payment_reminder',
            titleAr: 'تذكير: نوبة حجزك المتكرر مستنية الدفع',
            bodyAr: `${orderRef(event.orderNumber)} لسه مستنية الدفع. آخر ميعاد ${formatCairoDateTime(deadline)} — بعده النوبة دي بس هتتلغي وحجزك المتكرر يفضل شغّال.`,
            entityType: 'order',
            entityId: event.orderId,
            deepLink,
            actionType: RECURRING_PAYMENT_REMINDER_ACTION,
            targetAt: deadline,
          })
        : null;

      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'recurring_order_awaiting_payment',
        titleAr: 'طلبك المتكرر جاهز — كمّل الدفع',
        bodyAr: deadline
          ? `حجزك المتكرر جهّز نوبة جديدة (${orderRef(event.orderNumber)})${when}. ادفع قبل ${formatCairoDateTime(deadline)} عشان نبدأ ندوّر لك على مقدم الخدمة — لو الدفع ماتمّش، النوبة دي بس هتتلغي وحجزك المتكرر يفضل شغّال.`
          : `الحجز المتكرر بتاعك ولّد طلب جديد رقم ${event.orderNumber} — لازم تدفع إلكتروني قبل ما يبدأ البحث عن فني، وإلا هيتلغى تلقائيًا بعد مهلة الدفع.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink,
        workflowId: workflow?.id,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار انتظار الدفع للطلب المتكرر ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** دفع، إلغاء (أي طرف)، أو إلغاء تلقائي — أي خروج من pending_payment بيقفل تذكيرات الدفع. */
  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async resolveWhenNoLongerAwaitingPayment(event: OrderStatusChangedEvent): Promise<void> {
    if (event.previousStatus !== OrderStatus.PENDING_PAYMENT || event.newStatus === OrderStatus.PENDING_PAYMENT) return;
    await this.workflowService.resolve('order', event.orderId, RECURRING_PAYMENT_REMINDER_ACTION);
  }

  /** العميل بلّغ إنه حوّل — «ادفع» بعدها غلط، والتحويل بقى عند المالية (ومحمي من الإلغاء التلقائي). */
  @OnEvent(PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT)
  async resolveWhenTransferReported(event: PaymentInstaPayTransferReportedEvent): Promise<void> {
    await this.workflowService.resolve('order', event.orderId, RECURRING_PAYMENT_REMINDER_ACTION);
  }
}
