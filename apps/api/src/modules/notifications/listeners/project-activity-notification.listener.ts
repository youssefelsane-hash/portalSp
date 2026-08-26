import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PROJECT_ACTIVITY_EVENT, ProjectActivityEvent } from '../../../common/events/project-activity.event';
import { NotificationRoutingService } from '../notification-routing.service';
import { NotificationsService } from '../notifications.service';

/**
 * docs/08 §64.هـ — موديول المشروعات كان مالوش **ولا سطر إشعار واحد**: كل أكشن أدمن (عرض سعر،
 * طلب عربون، بدء/تسليم مرحلة، ضمان…) كان بيتسجّل في audit_log وبس، والعميل ما يعرفش غير لو فتح
 * التطبيق بالصدفة.
 *
 * المستمع ده عمدًا **غبي تمامًا**: الحدث بيوصل ومعاه user ids جاهزة ونص عربي جاهز، فمفيش أي منطق
 * مشروعات هنا يحتاج يتحدّث كل ما يتضاف أكشن جديد.
 */
@Injectable()
export class ProjectActivityNotificationListener {
  private readonly logger = new Logger(ProjectActivityNotificationListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly routingService: NotificationRoutingService,
  ) {}

  @OnEvent(PROJECT_ACTIVITY_EVENT)
  async handle(event: ProjectActivityEvent): Promise<void> {
    const recipients = [event.customerUserId, event.companyOwnerUserId].filter(
      (userId): userId is string => Boolean(userId),
    );
    for (const userId of recipients) {
      try {
        await this.notificationsService.notify({
          userId,
          notificationType: `project_${event.kind}`,
          titleAr: event.titleAr,
          bodyAr: event.bodyAr,
          referenceType: 'project',
          referenceId: event.projectId,
          deepLink: `/projects/${event.projectId}`,
        });
      } catch (err) {
        // فشل إشعار ما يبوظش الأكشن نفسه — الأكشن اتنفّذ واتسجّل في audit_log خلاص.
        this.logger.error(
          `فشل إشعار نشاط المشروع ${event.projectNumber} (${event.kind}) للمستخدم ${userId}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    // مشروع لسه ما اتعيّنش عليه شركة: الإشعار المفروض يروح "للجهة المنفّذة" مالوش مستقبِل.
    // بدل ما يضيع في الفراغ (رفض العميل لمرحلة مثلاً)، بيروح لفريق العمليات حسب قواعد التوجيه.
    if (event.companyRequested && !event.companyOwnerUserId) {
      await this.routingService.routeToRole(PROJECT_ACTIVITY_EVENT, {
        notificationType: `project_${event.kind}`,
        titleAr: `${event.titleAr} — ${event.projectNumber}`,
        bodyAr: event.bodyAr,
        referenceType: 'project',
        referenceId: event.projectId,
        deepLink: `/admin/projects/${event.projectId}`,
      });
    }
  }
}
