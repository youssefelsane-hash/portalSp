import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TECHNICIAN_ADMIN_ACTION_EVENT,
  TechnicianAdminActionEvent,
} from '../../../common/events/technician-admin-action.event';
import { NotificationsService } from '../notifications.service';

/** docs/08 §64.هـ — كل أكشن أدمن على فني/شركة بيوصله إشعار، مش بس انتقالات حالة التوثيق. */
@Injectable()
export class TechnicianAdminActionNotificationListener {
  private readonly logger = new Logger(TechnicianAdminActionNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(TECHNICIAN_ADMIN_ACTION_EVENT)
  async handle(event: TechnicianAdminActionEvent): Promise<void> {
    try {
      await this.notificationsService.notify({
        userId: event.userId,
        notificationType: `technician_${event.kind}`,
        titleAr: event.titleAr,
        bodyAr: event.bodyAr,
        referenceType: event.referenceType,
        referenceId: event.referenceId,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار أكشن الأدمن (${event.kind}) للمستخدم ${event.userId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
