import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  REFUND_RESOLVED_EVENT,
  RefundResolvedEvent,
} from '../../../common/events/refund-resolved.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationsService } from '../notifications.service';

interface RefundNotificationCopy {
  titleAr: string;
  bodyAr: string;
}

function formatAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2).replace(/\.00$/, '');
}

export function refundNotificationCopy(event: RefundResolvedEvent): RefundNotificationCopy {
  const amount = `${formatAmount(event.amountCents)} ج.م`;
  if (event.status === 'rejected') {
    return {
      titleAr: 'تعذر إتمام استرداد المبلغ',
      bodyAr: `لم يتم استرداد ${amount} للطلب ${event.orderNumber}. فريق الدعم سيراجع العملية.`,
    };
  }

  if (event.method === 'wallet_credit') {
    return {
      titleAr: 'تم استرداد المبلغ إلى محفظتك',
      bodyAr: `تمت إضافة ${amount} إلى محفظتك عن الطلب ${event.orderNumber}.`,
    };
  }

  if (event.method === 'original_method') {
    return {
      titleAr: 'تم استرداد المبلغ',
      bodyAr: `تم إرسال ${amount} إلى وسيلة الدفع الأصلية للطلب ${event.orderNumber}.`,
    };
  }

  return {
    titleAr: 'تم تسجيل استرداد المبلغ',
    bodyAr: `تم تسجيل استرداد ${amount} للطلب ${event.orderNumber}.`,
  };
}

@Injectable()
export class RefundNotificationListener {
  private readonly logger = new Logger(RefundNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(REFUND_RESOLVED_EVENT)
  async handle(event: RefundResolvedEvent): Promise<void> {
    const copy = refundNotificationCopy(event);
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerProfileId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: event.status === 'completed' ? 'refund_completed' : 'refund_rejected',
        titleAr: copy.titleAr,
        bodyAr: copy.bodyAr,
        referenceType: 'refund',
        referenceId: event.refundId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار نتيجة الاسترداد ${event.refundId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
