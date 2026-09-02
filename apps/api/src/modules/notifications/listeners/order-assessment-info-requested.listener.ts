import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_ASSESSMENT_INFO_REQUESTED_EVENT,
  OrderAssessmentInfoRequestedEvent,
} from '../../../common/events/order-assessment-info-requested.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

/**
 * بند 8 — الأدمن طلب معلومات/صور إضافية قبل التسعير.
 *
 * القرار ده **مابيغيّرش حالة الطلب** عمدًا، فمفيش إشعار حالة بيتبعت عنه. الـlistener ده هو
 * الوسيلة الوحيدة اللي العميل بيعرف بيها إن الكورة في ملعبه — من غيره الطلب بيفضل ساكت
 * والعميل مستني تسعير مش جاي.
 *
 * نفس نمط `OrderLockedProviderLostNotificationListener` بالحرف (workflow + multi-channel).
 */
@Injectable()
export class OrderAssessmentInfoRequestedListener {
  private readonly logger = new Logger(OrderAssessmentInfoRequestedListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(ORDER_ASSESSMENT_INFO_REQUESTED_EVENT)
  async handle(event: OrderAssessmentInfoRequestedEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const deepLink = `/orders/${event.orderId}`;
      const titleAr = 'محتاجين تفاصيل أكتر عشان نسعّر طلبك';
      const bodyAr = `طلب رقم ${event.orderNumber}: ${event.message}`;

      // فعل مطلوب من العميل (يرفع صور/يكتب تفاصيل) — مش إشعار خبري.
      const workflow = await this.workflowService.create({
        userId: customer.userId,
        notificationType: 'order_assessment_info_requested',
        titleAr,
        bodyAr,
        entityType: 'order',
        entityId: event.orderId,
        deepLink,
        actionType: 'provide_assessment_details',
      });

      await this.notificationsService.notifyMultiChannel(
        {
          userId: customer.userId,
          notificationType: 'order_assessment_info_requested',
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
        `فشل إشعار طلب معلومات إضافية للطلب ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
