import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WORK_OPPORTUNITY_OFFERED_EVENT, WorkOpportunityOfferedEvent } from '../../../common/events/work-opportunity-offered.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationsService } from '../notifications.service';

// نفس شكل عرض order_assignments العادي (order-offer-notification.listener.ts's orderOfferDeepLink)
// — apps/technician-app بتحتاج orderId فورًا لفتح تفاصيل الطلب من الإشعار مباشرة.
const workOpportunityDeepLink = (orderId: string): string => `/technician/orders/${orderId}`;

const formatServiceDay = (scheduledAt: Date | null): string => {
  if (!scheduledAt) return 'في أقرب وقت';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(scheduledAt);
};

/**
 * فرصة عمل اختيارية جديدة (docs/08 §36.1، بَقّة حقيقية اتلقطت 2026-08-20) — كانت فجوة موثّقة
 * صراحة: technician_work_opportunities كان بيتعمله INSERT من غير أي إشعار يوصل للفني خالص، عكس
 * عرض order_assignments العادي. الفني كان مضطر يفتح/يحدّث شاشة الطلبات المتاحة بنفسه عشان يكتشف
 * وجود فرصة — بلاغ مالك حقيقي إن فني بيوقف "يستقبل" فرص إضافية بعد أول شغلانة كان جزء منه (لو
 * مش كله) الفجوة دي: الفرصة كانت بتتخلق فعليًا بالباك-إند، بس الفني مالوش أي طريقة يعرف بيها.
 * one-shot بلا workflow/دورة تذكير (نفس فلسفة عرض order_assignments العادي — الفرصة بتفضل صالحة
 * للقبول طالما status='offered'، مفيش مهلة قصيرة تستاهل تذكير متكرر).
 */
@Injectable()
export class WorkOpportunityOfferedNotificationListener {
  private readonly logger = new Logger(WorkOpportunityOfferedNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(WORK_OPPORTUNITY_OFFERED_EVENT)
  async handle(event: WorkOpportunityOfferedEvent): Promise<void> {
    try {
      const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);
      const isCrewRecruit = event.context === 'crew_recruit';
      await this.notificationsService.notifyMultiChannel(
        {
          userId: technician.userId,
          notificationType: isCrewRecruit ? 'crew_recruit_opportunity' : 'work_opportunity',
          titleAr: isCrewRecruit ? 'دعوة انضمام لفريق' : 'فرصة شغل إضافي',
          bodyAr: isCrewRecruit
            ? `فريق طلب رقم ${event.orderNumber} محتاجك تنضم — راجع التفاصيل.`
            : `طلب رقم ${event.orderNumber} متاح ليك كفرصة إضافية يوم ${formatServiceDay(event.scheduledAt)} — راجع التفاصيل.`,
          referenceType: 'technician_work_opportunity',
          referenceId: event.opportunityId,
          deepLink: workOpportunityDeepLink(event.orderId),
        },
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );
    } catch (err) {
      this.logger.error(`فشل إشعار فرصة عمل اختيارية ${event.opportunityId}`, err instanceof Error ? err.stack : err);
    }
  }
}
