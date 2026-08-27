import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { COMPLAINT_MESSAGE_ADDED_EVENT, ComplaintMessageAddedEvent } from '../../../common/events/complaint-message-added.event';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class ComplaintRepliedNotificationListener {
  private readonly logger = new Logger(ComplaintRepliedNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(COMPLAINT_MESSAGE_ADDED_EVENT)
  async handleComplaintMessageAdded(event: ComplaintMessageAddedEvent): Promise<void> {
    try {
      await this.notificationsService.notify({
        userId: event.recipientUserId,
        notificationType: 'complaint_reply',
        titleAr: 'رد جديد على شكواك',
        bodyAr: `فريق الدعم رد على شكوى ${event.complaintNumber}`,
        referenceType: 'complaint',
        referenceId: event.complaintId,
        deepLink: `/complaints/${event.complaintId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار رد على الشكوى ${event.complaintId}`, err instanceof Error ? err.stack : err);
    }
  }
}
