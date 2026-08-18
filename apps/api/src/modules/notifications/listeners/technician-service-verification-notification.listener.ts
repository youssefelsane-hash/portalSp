import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TECHNICIAN_SERVICE_VERIFICATION_CHANGED_EVENT,
  TechnicianServiceVerificationChangedEvent,
} from '../../../common/events/technician-service-verification-changed.event';
import { TechnicianServiceVerificationStatus } from '../../catalog/entities/technician-service.entity';
import { NotificationsService } from '../notifications.service';

// نفس نمط technician-verification-notification.listener.ts بالحرف — بننبّه بس على القرارات
// النهائية (اعتماد/رفض)، مش على pending_verification نفسها (مفيش قرار حقيقي لسه وقتها).
@Injectable()
export class TechnicianServiceVerificationNotificationListener {
  private readonly logger = new Logger(TechnicianServiceVerificationNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(TECHNICIAN_SERVICE_VERIFICATION_CHANGED_EVENT)
  async handleVerificationChanged(event: TechnicianServiceVerificationChangedEvent): Promise<void> {
    if (
      event.newStatus !== TechnicianServiceVerificationStatus.APPROVED &&
      event.newStatus !== TechnicianServiceVerificationStatus.REJECTED &&
      event.newStatus !== TechnicianServiceVerificationStatus.SUSPENDED
    ) {
      return;
    }

    try {
      const titleAr =
        event.newStatus === TechnicianServiceVerificationStatus.APPROVED
          ? 'مبروك! مهارة جديدة اتعتمدت'
          : event.newStatus === TechnicianServiceVerificationStatus.REJECTED
            ? 'طلب مهارة اترفض'
            : 'مهارة اتوقفت مؤقتًا';
      const bodyAr =
        event.newStatus === TechnicianServiceVerificationStatus.APPROVED
          ? `طلبك لتقديم خدمة "${event.serviceNameAr}" اتعتمد — هتوصلك طلبات ليها دلوقتي.`
          : event.newStatus === TechnicianServiceVerificationStatus.REJECTED
            ? `طلبك لتقديم خدمة "${event.serviceNameAr}" اترفض: ${event.reason ?? 'راجع تفاصيل الرفض مع فريق الدعم.'}`
            : `تقديمك لخدمة "${event.serviceNameAr}" اتوقف مؤقتًا: ${event.reason ?? 'راجع فريق الدعم.'}`;

      await this.notificationsService.notify({
        userId: event.technicianUserId,
        notificationType:
          event.newStatus === TechnicianServiceVerificationStatus.APPROVED
            ? 'technician_service_approved'
            : event.newStatus === TechnicianServiceVerificationStatus.REJECTED
              ? 'technician_service_rejected'
              : 'technician_service_suspended',
        titleAr,
        bodyAr,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار تغيير حالة اعتماد مهارة الفني ${event.technicianServiceId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
