import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_OFFER_CREATED_EVENT, OrderOfferCreatedEvent } from '../../../common/events/order-offer-created.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

// orderId مدموج في الـpath عمدًا — apps/technician-app بتحتاجه فورًا في حمولة الإشعار (data-only
// FCM payload، راجع FcmPushDispatcher) عشان تقدر تنادي POST /technician/orders/:id/accept|reject
// من زرار الإشعار مباشرة من غير ما تفتح التطبيق الأول (accept()/reject() في matching.service.ts
// بياخدوا orderId، مش assignmentId).
const orderOfferDeepLink = (orderId: string): string => `/technician/orders/${orderId}`;

/**
 * عرض طلب جديد لفني (docs/08 §17.16) — عادي (informational-ish action_required، one-shot،
 * مفيش workflow/دورة تذكير لأن نافذة الرد نفسها ثواني قليلة، مفيش معنى لتذكير "بعد ساعة")
 * أو طوارئ (critical_offer، **workflow-backed** — دورة تذكير قصيرة جوّه نافذة الصلاحية نفسها،
 * راجع NotificationWorkflowReminderService، تتوقف تلقائيًا عبر OrderOfferResolutionListener).
 */
@Injectable()
export class OrderOfferNotificationListener {
  private readonly logger = new Logger(OrderOfferNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(ORDER_OFFER_CREATED_EVENT)
  async handle(event: OrderOfferCreatedEvent): Promise<void> {
    try {
      const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);

      if (event.isEmergency) {
        const workflow = await this.workflowService.create({
          userId: technician.userId,
          notificationType: 'order_offer_emergency',
          titleAr: 'طلب طوارئ جديد',
          bodyAr: `طلب طوارئ رقم ${event.orderNumber} قريب منك — قبول/رفض سريع.`,
          entityType: 'order_assignment',
          entityId: event.assignmentId,
          deepLink: orderOfferDeepLink(event.orderId),
          actionType: 'accept_reject_offer',
          expiresAt: event.expiresAt,
        });
        await this.notificationsService.notifyMultiChannel(
          {
            userId: technician.userId,
            notificationType: 'order_offer_emergency',
            titleAr: workflow.titleAr,
            bodyAr: workflow.bodyAr,
            referenceType: 'order_assignment',
            referenceId: event.assignmentId,
            deepLink: orderOfferDeepLink(event.orderId),
            workflowId: workflow.id,
          },
          [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        );
      } else {
        // عرض عادي — إرسال فوري بس، بلا workflow (نافذة الرد قصيرة جدًا، تذكير لاحق مالوش معنى).
        await this.notificationsService.notifyMultiChannel(
          {
            userId: technician.userId,
            notificationType: 'order_offer',
            titleAr: 'طلب جديد قريب منك',
            bodyAr: `طلب رقم ${event.orderNumber} متاح دلوقتي — أول واحد يقبل ياخده.`,
            referenceType: 'order_assignment',
            referenceId: event.assignmentId,
            deepLink: orderOfferDeepLink(event.orderId),
          },
          [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        );
      }
    } catch (err) {
      this.logger.error(`فشل إشعار عرض طلب ${event.assignmentId}`, err instanceof Error ? err.stack : err);
    }
  }
}
