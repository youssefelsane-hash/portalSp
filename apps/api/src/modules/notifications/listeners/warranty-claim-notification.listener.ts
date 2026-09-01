import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WARRANTY_CLAIM_CHANGED_EVENT,
  WarrantyClaimChangedEvent,
} from '../../../common/events/warranty-claim-changed.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationsService } from '../notifications.service';

interface WarrantyClaimNotificationCopy {
  titleAr: string;
  bodyAr: string;
}

export function warrantyClaimNotificationCopy(event: WarrantyClaimChangedEvent): WarrantyClaimNotificationCopy | null {
  switch (event.status) {
    case 'under_review':
      return {
        titleAr: 'مطالبة الضمان قيد المراجعة',
        bodyAr: 'فريقنا بدأ مراجعة مطالبة الضمان الخاصة بك، وسنبلغك بأي تحديث جديد.',
      };
    case 'inspection_scheduled':
      return {
        titleAr: 'تم تحديد معاينة للضمان',
        bodyAr: 'تم نقل مطالبة الضمان إلى مرحلة المعاينة، وسيتواصل معك الفريق لتأكيد التفاصيل.',
      };
    case 'approved':
      return {
        titleAr: 'تم قبول مطالبة الضمان',
        bodyAr: 'وافقنا على مطالبة الضمان الخاصة بك، وبدأنا ترتيب خطوات الإصلاح.',
      };
    case 'rejected':
      return {
        titleAr: 'تعذر قبول مطالبة الضمان',
        bodyAr: event.rejectionReason?.trim()
          ? `سبب الرفض: ${event.rejectionReason.trim()}`
          : 'راجع تفاصيل المطالبة أو تواصل مع الدعم لمعرفة سبب الرفض.',
      };
    case 'repair_in_progress':
      return {
        titleAr: 'بدأ إصلاح الضمان',
        bodyAr: 'مطالبة الضمان دخلت مرحلة الإصلاح، وسنبلغك عند اكتمالها.',
      };
    case 'resolved':
      return {
        titleAr: 'تم حل مطالبة الضمان',
        bodyAr: event.resolutionNotes?.trim()
          ? event.resolutionNotes.trim()
          : 'تم تسجيل حل المشكلة المشمولة بالضمان بنجاح.',
      };
    case 'closed':
      return {
        titleAr: 'تم إغلاق مطالبة الضمان',
        bodyAr: 'اكتملت متابعة مطالبة الضمان وتم إغلاقها.',
      };
    default:
      return null;
  }
}

@Injectable()
export class WarrantyClaimNotificationListener {
  private readonly logger = new Logger(WarrantyClaimNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(WARRANTY_CLAIM_CHANGED_EVENT)
  async handle(event: WarrantyClaimChangedEvent): Promise<void> {
    if (event.action !== 'reviewed' || !event.customerProfileId || !event.status) return;
    const copy = warrantyClaimNotificationCopy(event);
    if (!copy) return;

    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerProfileId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: `warranty_claim_${event.status}`,
        titleAr: copy.titleAr,
        bodyAr: copy.bodyAr,
        referenceType: 'warranty_claim',
        referenceId: event.claimId,
        deepLink: '/warranties',
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار تحديث مطالبة الضمان ${event.claimId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
