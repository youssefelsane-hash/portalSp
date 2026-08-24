import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  INSTALLMENT_APPLICATION_SUBMITTED_EVENT,
  INSTALLMENTS_APPLICATION_REVIEWED_EVENT,
  INSTALLMENT_PAYMENT_FAILED_EVENT,
  INSTALLMENT_PAYMENT_SUCCEEDED_EVENT,
  INSTALLMENTS_PLAN_COMPLETED_EVENT,
  InstallmentApplicationReviewedEvent,
  InstallmentApplicationSubmittedEvent,
} from '../../../common/events/installment.events';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationsService } from '../notifications.service';
import { NotificationRoutingService } from '../notification-routing.service';

/**
 * إشعارات دورة التقسيط — نفس نمط باقي الـlisteners: fire-and-forget، كل handler بيمتلك
 * try/catch (فشل الإشعار مايكسرش العملية الحقيقية). الأحداث اللي ليها routing rules في
 * migration 0177 بتتبعت لفريق finance عبر NotificationRoutingService، ورسائل العميل مباشرة.
 */
@Injectable()
export class InstallmentNotificationListener {
  private readonly logger = new Logger(InstallmentNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
    private readonly routingService: NotificationRoutingService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** تقديم جديد → إشعار استلام للعميل + توجيه لـfinance (rule من 0177). */
  @OnEvent(INSTALLMENT_APPLICATION_SUBMITTED_EVENT)
  async onSubmitted(event: InstallmentApplicationSubmittedEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'installment_application_submitted',
        titleAr: 'استلمنا طلب التقسيط',
        bodyAr: `طلب التقسيط على الحجز ${event.orderNumber} بمبلغ ${Math.round(event.totalFinancedCents / 100)} ج.م تحت المراجعة — هنبلغك بالنتيجة.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
      await this.routingService.routeToRole('installment.application_submitted', {
        notificationType: 'installment_application_submitted_ops',
        titleAr: 'طلب تقسيط جديد محتاج مراجعة',
        bodyAr: `حجز ${event.orderNumber} — إجمالي ممول ${Math.round(event.totalFinancedCents / 100)} ج.م`,
        referenceType: 'installment_application',
        referenceId: event.applicationId,
        deepLink: '/admin/installments',
      });
    } catch (err) {
      this.logger.error('فشل إشعار تقديم تقسيط', err instanceof Error ? err.stack : err);
    }
  }

  /** قرار المراجعة → العميل (اعتماد = الجدولة نشطة / رفض بالسبب). */
  @OnEvent(INSTALLMENTS_APPLICATION_REVIEWED_EVENT)
  async onReviewed(event: InstallmentApplicationReviewedEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const [row] = await this.dataSource.query<{ order_number: string }[]>(
        `SELECT order_number FROM orders WHERE id = $1`,
        [event.orderId],
      );
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: event.approved ? 'installment_application_approved' : 'installment_application_rejected',
        titleAr: event.approved ? 'اتقبل طلب التقسيط' : 'طلب التقسيط ماتقبلش',
        bodyAr: event.approved
          ? `خطة التقسيط على الحجز ${row?.order_number ?? ''} بقت نشطة — هتلاقي جدولة الأقساط في "أقساطي".`
          : `طلب التقسيط على الحجز ${row?.order_number ?? ''} اترفض. السبب: ${event.reasonAr ?? '—'}`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error('فشل إشعار نتيجة مراجعة التقسيط', err instanceof Error ? err.stack : err);
    }
  }

  /** نجاح تحصيل قسط → العميل. */
  @OnEvent(INSTALLMENT_PAYMENT_SUCCEEDED_EVENT)
  async onPaymentSucceeded(payload: {
    installmentId: string;
    applicationId: string;
    orderId: string;
    customerId: string;
    sequenceNumber: number;
    amountCents: number;
  }): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(payload.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'installment_payment_succeeded',
        titleAr: 'القسط اتحصّل بنجاح',
        bodyAr: `قسط رقم ${payload.sequenceNumber} بمبلغ ${Math.round(payload.amountCents / 100)} ج.م اتحصّل — شكرًا ليك.`,
        referenceType: 'order',
        referenceId: payload.orderId,
        deepLink: `/orders/${payload.orderId}`,
      });
    } catch (err) {
      this.logger.error('فشل إشعار نجاح قسط', err instanceof Error ? err.stack : err);
    }
  }

  /** فشل تحصيل قسط → العميل + finance routing (rule من 0177). */
  @OnEvent(INSTALLMENT_PAYMENT_FAILED_EVENT)
  async onPaymentFailed(payload: {
    installmentId: string;
    applicationId: string;
    orderId: string;
    customerId: string;
    sequenceNumber: number;
    amountCents: number;
    failureReason: string | null;
  }): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(payload.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'installment_payment_failed',
        titleAr: 'محاولة تحصيل القسط فشلت',
        bodyAr: `قسط رقم ${payload.sequenceNumber} (${Math.round(payload.amountCents / 100)} ج.م) ماتحصّلش — راجع وسيلة الدفع المحفوظة عشان نقدر نعيد المحاولة.`,
        referenceType: 'order',
        referenceId: payload.orderId,
        deepLink: `/orders/${payload.orderId}`,
      });
      await this.routingService.routeToRole('installment.payment_failed', {
        notificationType: 'installment_payment_failed_ops',
        titleAr: 'فشل تحصيل قسط',
        bodyAr: `قسط #${payload.sequenceNumber} بمبلغ ${Math.round(payload.amountCents / 100)} ج.م — السبب: ${payload.failureReason ?? 'غير معروف'}`,
        referenceType: 'installment_application',
        referenceId: payload.applicationId,
        deepLink: '/admin/installments',
      });
    } catch (err) {
      this.logger.error('فشل إشعار فشل قسط', err instanceof Error ? err.stack : err);
    }
  }

  /** اكتمال الخطة → العميل. */
  @OnEvent(INSTALLMENTS_PLAN_COMPLETED_EVENT)
  async onPlanCompleted(payload: { applicationId: string; customerId: string }): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(payload.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'installment_plan_completed',
        titleAr: 'خلّصت كل الأقساط',
        bodyAr: 'دفعت كل أقساط الخطة بالكامل — شكرًا لثقتك.',
      });
    } catch (err) {
      this.logger.error('فشل إشعار اكتمال الخطة', err instanceof Error ? err.stack : err);
    }
  }
}
