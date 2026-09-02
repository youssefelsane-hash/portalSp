import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_QUOTE_EXPIRED_EVENT, OrderQuoteExpiredEvent } from '../../../common/events/order-quote-expired.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationRoutingService } from '../notification-routing.service';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

function egp(amountCents: number): string {
  return (amountCents / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * ADR-0067 §2 — عرض سعر عدّى مهلته واتقفل بالكاسح.
 *
 * تلات أطراف بتتبلّغ لأسباب مختلفة: العميل (سعره سقط والطلب واقف)، الأدمن (لازم يعيد الإصدار أو
 * يقفل الطلب — مفيش مسار تلقائي بيعمل ده)، والفني اللي بعت العرض لو كان فني (شغله معلّق).
 *
 * الـworkflow **مابيتعملش للعميل** هنا رغم إن الطلب واقف: مفيش فعل العميل يقدر يعمله لوحده بعد
 * انتهاء العرض — إعادة الإصدار قرار أدمن. تذكير للعميل كان هيبقى تذكير بحاجة مش في إيده.
 */
@Injectable()
export class OrderQuoteExpiredNotificationListener {
  private readonly logger = new Logger(OrderQuoteExpiredNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
    private readonly routingService: NotificationRoutingService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(ORDER_QUOTE_EXPIRED_EVENT)
  async handle(event: OrderQuoteExpiredEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const deepLink = `/orders/${event.orderId}`;
      const titleAr = 'انتهت صلاحية عرض السعر';
      const bodyAr = `طلب رقم ${event.orderNumber}: عرض ${egp(event.amountCents)} ج.م خلصت مهلته قبل ما توافق. الطلب لسه قايم — فريقنا هيراجعه ويبعتلك سعر محدّث.`;

      await this.notificationsService.notifyMultiChannel(
        {
          userId: customer.userId,
          notificationType: 'order_quote_expired',
          titleAr,
          bodyAr,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink,
        },
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );

      // العرض خلص، فتذكيرات «وافق على السعر» بقت بتذكّر بحاجة مش موجودة.
      await this.workflowService.resolve('order', event.orderId, 'approve_quote');

      await this.routingService.routeToRole('order.quote_expired', {
        notificationType: 'order_quote_expired_ops',
        titleAr: `عرض سعر انتهت صلاحيته: ${event.orderNumber}`,
        bodyAr: `عرض ${egp(event.amountCents)} ج.م سقط من غير رد من العميل — الطلب محتاج إعادة إصدار عرض أو قرار إداري.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });

      if (event.submittedByUserId) {
        await this.notificationsService.notify({
          userId: event.submittedByUserId,
          notificationType: 'order_quote_expired_technician',
          titleAr: 'عرض السعر بتاعك انتهت صلاحيته',
          bodyAr: `طلب رقم ${event.orderNumber}: العميل مردّش خلال المهلة. الطلب اتوقف لحد ما الإدارة تعيد إصدار العرض.`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `فشل إشعار انتهاء صلاحية العرض للطلب ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
