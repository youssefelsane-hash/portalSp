import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_ROUTED_TO_ONSITE_ASSESSMENT_EVENT,
  OrderRoutedToOnsiteAssessmentEvent,
} from '../../../common/events/order-routed-to-onsite-assessment.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationsService } from '../notifications.service';

function egp(amountCents: number): string {
  return (amountCents / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * ADR-0067 §1 — الصور ماكانتش كافية، فالطلب اتحوّل لمعاينة في الموقع.
 *
 * العميل ماكانش بياخد **ولا إشعار** على التحويل ده: الحالة الجديدة `SEARCHING_TECHNICIAN` مش في
 * `CUSTOMER_MESSAGES` (وده صح — التوزيع العادي مش خبر)، وفي نفس الوقت رسم المعاينة اتضاف على
 * الطلب. الرسم بيتذكر صراحة في النص لأنه **مبلغ جديد على العميل**، والقاعدة إن أي مبلغ جديد
 * لازم يعرفه.
 */
@Injectable()
export class OrderRoutedToOnsiteNotificationListener {
  private readonly logger = new Logger(OrderRoutedToOnsiteNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_ROUTED_TO_ONSITE_ASSESSMENT_EVENT)
  async handle(event: OrderRoutedToOnsiteAssessmentEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const feeText =
        event.inspectionFeeCents > 0
          ? ` رسم المعاينة ${egp(event.inspectionFeeCents)} ج.م، وبيتخصم من سعر الشغل حسب سياسة الخدمة.`
          : ' المعاينة من غير رسوم.';

      await this.notificationsService.notifyMultiChannel(
        {
          userId: customer.userId,
          notificationType: 'order_routed_to_onsite_assessment',
          titleAr: 'هنعاين طلبك على الطبيعة',
          bodyAr: `طلب رقم ${event.orderNumber}: الصور مش كافية لتحديد سعر دقيق، فهنبعتلك فني يعاين المكان ويحدد السعر.${feeText}`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/orders/${event.orderId}`,
        },
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );
    } catch (err) {
      this.logger.error(
        `فشل إشعار التحويل لمعاينة في الموقع للطلب ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
