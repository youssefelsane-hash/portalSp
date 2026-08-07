import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { COMPLAINT_FILED_EVENT, ComplaintFiledEvent } from '../../../common/events/complaint-filed.event';
import { NotificationRoutingService } from '../notification-routing.service';

@Injectable()
export class ComplaintFiledRoutingListener {
  private readonly logger = new Logger(ComplaintFiledRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(COMPLAINT_FILED_EVENT)
  async handleComplaintFiled(event: ComplaintFiledEvent): Promise<void> {
    try {
      await this.routingService.routeToRole(COMPLAINT_FILED_EVENT, {
        notificationType: 'complaint_filed',
        titleAr: `شكوى جديدة: ${event.complaintNumber}`,
        bodyAr: event.title,
        referenceType: 'complaint',
        referenceId: event.complaintId,
        deepLink: `/admin/complaints/${event.complaintId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار الشكوى ${event.complaintId}`, err instanceof Error ? err.stack : err);
    }
  }
}
