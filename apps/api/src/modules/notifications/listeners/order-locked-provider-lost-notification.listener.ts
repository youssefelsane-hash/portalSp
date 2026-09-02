import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_LOCKED_PROVIDER_LOST_EVENT,
  OrderLockedProviderLostEvent,
} from '../../../common/events/order-locked-provider-lost.event';
import {
  LOCKED_PROVIDER_LOST_MESSAGE_AR,
  LOCKED_PROVIDER_LOST_REASON_AR,
} from '../../orders/order-provider-lock';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationRoutingService } from '../notification-routing.service';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

/**
 * ADR-0065 §2 — الفني المقفول ضاع، والطلب واقف مستني العميل يختار من جديد.
 *
 * الرسالة بتقول تلات حاجات بالترتيب ده بالظبط: مين ضاع، **إن مفيش حد اتحجز بداله ومفيش سعر
 * اتغيّر**، والخطوة الجاية. النص التاني هو الأهم — من غيره العميل هيفترض إن حد تاني اتحجزله
 * وإن السعر اختلف، وده اللي المالك رافضه أصلاً.
 *
 * نفس نمط `TechnicianCancellationNotificationListener` بالحرف (نسخة عميل multi-channel + نسخة
 * تشغيلية للأدمن عبر `NotificationRoutingService`) — مفيش نظام توجيه موازي.
 */
@Injectable()
export class OrderLockedProviderLostNotificationListener {
  private readonly logger = new Logger(OrderLockedProviderLostNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
    private readonly routingService: NotificationRoutingService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(ORDER_LOCKED_PROVIDER_LOST_EVENT)
  async handle(event: OrderLockedProviderLostEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const deepLink = `/orders/${event.orderId}/select-technician`;
      const body = `طلب رقم ${event.orderNumber}: ${LOCKED_PROVIDER_LOST_MESSAGE_AR}`;

      // العميل مطلوب منه فعل حقيقي (يختار من جديد) — `action_required` مش إشعار خبري.
      const workflow = await this.workflowService.create({
        userId: customer.userId,
        notificationType: 'order_locked_provider_lost',
        titleAr: 'الفني اللي اخترته مابقاش متاح',
        bodyAr: body,
        entityType: 'order',
        entityId: event.orderId,
        deepLink,
        actionType: 'select_replacement_technician',
      });

      await this.notificationsService.notifyMultiChannel(
        {
          userId: customer.userId,
          notificationType: 'order_locked_provider_lost',
          titleAr: 'الفني اللي اخترته مابقاش متاح',
          bodyAr: body,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink,
          workflowId: workflow?.id,
        },
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );

      await this.routingService.routeToRole('order.technician_cancelled', {
        notificationType: 'order_locked_provider_lost_ops',
        titleAr: `قفل المنفّذ اتفك: ${event.orderNumber}`,
        bodyAr: `${LOCKED_PROVIDER_LOST_REASON_AR[event.reason]} — الطلب واقف مستني العميل يختار منفّذ جديد، وماتوزّعش على حد تاني.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار فك قفل المنفّذ للطلب ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
