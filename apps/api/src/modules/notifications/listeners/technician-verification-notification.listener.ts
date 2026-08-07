import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TECHNICIAN_VERIFICATION_CHANGED_EVENT,
  TechnicianVerificationChangedEvent,
} from '../../../common/events/technician-verification-changed.event';
import { TechnicianVerificationStatus } from '../../technicians/entities/technician-profile.entity';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class TechnicianVerificationNotificationListener {
  private readonly logger = new Logger(TechnicianVerificationNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(TECHNICIAN_VERIFICATION_CHANGED_EVENT)
  async handleVerificationChanged(event: TechnicianVerificationChangedEvent): Promise<void> {
    if (event.newStatus !== TechnicianVerificationStatus.APPROVED && event.newStatus !== TechnicianVerificationStatus.REJECTED) {
      return; // بننبّه بس على القرارات النهائية، مش كل خطوة مراجعة داخلية
    }

    try {
      const approved = event.newStatus === TechnicianVerificationStatus.APPROVED;
      await this.notificationsService.notify({
        userId: event.technicianUserId,
        notificationType: approved ? 'technician_approved' : 'technician_rejected',
        titleAr: approved ? 'مبروك! حسابك اتعتمد' : 'حسابك اترفض',
        bodyAr: approved
          ? 'حسابك كفني بقى معتمد رسمياً — تقدر تبدأ تستقبل طلبات دلوقتي.'
          : `حسابك اترفض: ${event.reason ?? 'راجع تفاصيل الرفض مع فريق الدعم.'}`,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار تغيير حالة اعتماد الفني ${event.technicianProfileId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
