import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TECHNICIAN_CATEGORY_VERIFICATION_CHANGED_EVENT,
  TechnicianCategoryVerificationChangedEvent,
} from '../../../common/events/technician-category-verification-changed.event';
import { TechnicianServiceVerificationStatus } from '../../catalog/entities/technician-service.entity';
import { NotificationsService } from '../notifications.service';

// نفس نمط technician-service-verification-notification.listener.ts بالحرف (ADR-0018 §8) —
// بننبّه بس على القرارات النهائية (اعتماد/رفض/إيقاف)، مش على pending_verification نفسها.
@Injectable()
export class TechnicianCategoryVerificationNotificationListener {
  private readonly logger = new Logger(TechnicianCategoryVerificationNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(TECHNICIAN_CATEGORY_VERIFICATION_CHANGED_EVENT)
  async handleVerificationChanged(event: TechnicianCategoryVerificationChangedEvent): Promise<void> {
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
          ? 'مبروك! تخصص جديد اتعتمد'
          : event.newStatus === TechnicianServiceVerificationStatus.REJECTED
            ? 'طلب تخصص اترفض'
            : 'تخصص اتوقف مؤقتًا';
      const bodyAr =
        event.newStatus === TechnicianServiceVerificationStatus.APPROVED
          ? `طلبك للاعتماد كتخصص "${event.categoryNameAr}" اتعتمد — هتوصلك طلبات كل خدمات التخصص ده دلوقتي.`
          : event.newStatus === TechnicianServiceVerificationStatus.REJECTED
            ? `طلبك للاعتماد كتخصص "${event.categoryNameAr}" اترفض: ${event.reason ?? 'راجع تفاصيل الرفض مع فريق الدعم.'}`
            : `اعتمادك كتخصص "${event.categoryNameAr}" اتوقف مؤقتًا: ${event.reason ?? 'راجع فريق الدعم.'}`;

      await this.notificationsService.notify({
        userId: event.technicianUserId,
        notificationType:
          event.newStatus === TechnicianServiceVerificationStatus.APPROVED
            ? 'technician_category_approved'
            : event.newStatus === TechnicianServiceVerificationStatus.REJECTED
              ? 'technician_category_rejected'
              : 'technician_category_suspended',
        titleAr,
        bodyAr,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار تغيير حالة اعتماد تخصص الفني ${event.technicianCategoryId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
