import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TECHNICIAN_ORDER_CANCELLED_EVENT,
  TechnicianOrderCancelledEvent,
} from '../../../common/events/technician-order-cancelled.event';
import { CancellationRecoveryAction } from '../../orders/entities/technician-order-cancellation.entity';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationRoutingService } from '../notification-routing.service';
import { NotificationsService } from '../notifications.service';

// سياسة إلغاء الفني (docs/10) — إشعار عالي الأولوية للعميل (in_app + push، مش in_app بس) بسبب
// آمن للعميل + رابط مباشر، ونسخة تشغيلية للأدمن عبر NotificationRoutingService الموجود أصلاً
// (نفس نمط EmergencyOrderRoutingListener بالحرف — مفيش نظام توجيه موازي).
@Injectable()
export class TechnicianCancellationNotificationListener {
  private readonly logger = new Logger(TechnicianCancellationNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
    private readonly routingService: NotificationRoutingService,
  ) {}

  @OnEvent(TECHNICIAN_ORDER_CANCELLED_EVENT)
  async handle(event: TechnicianOrderCancelledEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerProfileId);
      const deepLink =
        event.recoveryAction === CancellationRecoveryAction.MANUAL_RESELECTION_REQUIRED
          ? `/orders/${event.orderId}/select-technician`
          : `/orders/${event.orderId}`;
      const body =
        event.recoveryAction === CancellationRecoveryAction.MANUAL_RESELECTION_REQUIRED
          ? `الفني اعتذر عن طلب رقم ${event.orderNumber} — السبب: ${event.customerSafeReasonAr}. اختار فني بديل بنفسك دلوقتي.`
          : `الفني اعتذر عن طلب رقم ${event.orderNumber} — السبب: ${event.customerSafeReasonAr}. بندوّرلك على فني بديل فورًا.`;

      await this.notificationsService.notifyMultiChannel(
        {
          userId: customer.userId,
          notificationType: 'order_technician_cancelled',
          titleAr: 'الفني اعتذر عن طلبك',
          bodyAr: body,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink,
        },
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );

      await this.routingService.routeToRole('order.technician_cancelled', {
        notificationType: 'order_technician_cancelled_ops',
        titleAr: `فني لغى طلب: ${event.orderNumber}`,
        bodyAr: `السبب: ${event.customerSafeReasonAr} — إجراء الاسترجاع: ${event.recoveryAction === CancellationRecoveryAction.AUTO_REMATCH ? 'إعادة مطابقة تلقائية' : 'محتاج العميل يختار فني بديل'}.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار إلغاء الفني للطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
