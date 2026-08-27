import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { COMPLAINT_STATUS_CHANGED_EVENT, ComplaintStatusChangedEvent } from '../../../common/events/complaint-status-changed.event';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class ComplaintStatusChangedNotificationListener {
  private readonly logger = new Logger(ComplaintStatusChangedNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(COMPLAINT_STATUS_CHANGED_EVENT)
  async handleComplaintStatusChanged(event: ComplaintStatusChangedEvent): Promise<void> {
    try {
      await this.notificationsService.notify({
        userId: event.recipientUserId,
        notificationType: 'complaint_resolved',
        titleAr: 'تحديث على شكواك',
        bodyAr: `شكوى ${event.complaintNumber} ${event.statusLabelAr}`,
        referenceType: 'complaint',
        referenceId: event.complaintId,
        deepLink: `/complaints/${event.complaintId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار تغيير حالة الشكوى ${event.complaintId}`, err instanceof Error ? err.stack : err);
    }
  }
}
