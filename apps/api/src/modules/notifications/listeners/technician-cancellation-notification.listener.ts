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
import { NotificationWorkflowService } from '../notification-workflow.service';
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
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(TECHNICIAN_ORDER_CANCELLED_EVENT)
  async handle(event: TechnicianOrderCancelledEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerProfileId);
      const requiresManualReselection = event.recoveryAction === CancellationRecoveryAction.MANUAL_RESELECTION_REQUIRED;
      const deepLink = requiresManualReselection ? `/orders/${event.orderId}/select-technician` : `/orders/${event.orderId}`;
      const body = requiresManualReselection
        ? `الفني اعتذر عن طلب رقم ${event.orderNumber} — السبب: ${event.customerSafeReasonAr}. اختار فني بديل بنفسك دلوقتي.`
        : `الفني اعتذر عن طلب رقم ${event.orderNumber} — السبب: ${event.customerSafeReasonAr}. بندوّرلك على فني بديل فورًا.`;

      // العميل لازم يختار بنفسه (مش auto-rematch) — action_required حقيقي (ADR-0012، تصحيح
      // المالك الصريح: "الرفض نفسه مش المهم، المهم هل العميل مطلوب منه يعمل حاجة"). نوع منفصل
      // عن order_technician_cancelled (informational، لسه بيتستخدم لحالة الـauto-rematch تحت).
      const workflow = requiresManualReselection
        ? await this.workflowService.create({
            userId: customer.userId,
            notificationType: 'order_technician_cancelled_manual_reselection',
            titleAr: 'الفني اعتذر عن طلبك',
            bodyAr: body,
            entityType: 'order',
            entityId: event.orderId,
            deepLink,
            actionType: 'select_replacement_technician',
          })
        : null;

      await this.notificationsService.notifyMultiChannel(
        {
          userId: customer.userId,
          notificationType: requiresManualReselection ? 'order_technician_cancelled_manual_reselection' : 'order_technician_cancelled',
          titleAr: 'الفني اعتذر عن طلبك',
          bodyAr: body,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink,
          workflowId: workflow?.id,
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
