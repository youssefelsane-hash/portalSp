import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import { OrderStatus } from '../../orders/entities/order.entity';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

// عنوان/محتوى الإشعار للعميل حسب الحالة الجديدة — الحالات غير المذكورة هنا (draft, pending_payment, ...)
// مش من مخرجات transitionAsTechnician/cancel أصلاً، فمش محتاجة تتغطى هنا.
const CUSTOMER_MESSAGES: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  [OrderStatus.TECHNICIAN_ON_WAY]: { title: 'الفني في الطريق', body: 'الفني بدأ يتحرّك ناحيتك دلوقتي.' },
  [OrderStatus.TECHNICIAN_ARRIVED]: { title: 'الفني وصل', body: 'الفني وصل لعنوانك.' },
  [OrderStatus.IN_PROGRESS]: { title: 'الشغل بدأ', body: 'الفني بدأ الشغل على طلبك.' },
  [OrderStatus.AWAITING_QUOTE_APPROVAL]: {
    title: 'عرض سعر جديد يستنى موافقتك',
    body: 'الفني اقترح بنود إضافية (قطع غيار/أجرة إضافية) — راجع التفاصيل ووافق أو ارفض.',
  },
  [OrderStatus.WORK_COMPLETED]: { title: 'الشغل خلص', body: 'الفني خلّص الشغل — راجع الفاتورة واختار طريقة الدفع.' },
  // سياسة إلغاء الفني (ADR-0006) — الفني اللي اخترته اعتذر، وطلبك مش هيترجع للمطابقة التلقائية
  // (اعتماد/تعيين يدوي)، فمحتاج تعيد الاختيار بنفسك.
  [OrderStatus.NEEDS_TECHNICIAN_RESELECTION]: {
    title: 'الفني اعتذر — محتاج تعيد الاختيار',
    body: 'الفني اللي اخترته اعتذر عن الطلب. اطلب إعادة مطابقة أو اختار فني تاني.',
  },
};

@Injectable()
export class OrderStatusNotificationListener {
  private readonly logger = new Logger(OrderStatusNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      const customerMessage = CUSTOMER_MESSAGES[event.newStatus];
      if (customerMessage) {
        const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
        await this.notificationsService.notify({
          userId: customer.userId,
          notificationType: `order_${event.newStatus}`,
          titleAr: customerMessage.title,
          bodyAr: customerMessage.body,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/orders/${event.orderId}`,
        });
      }

      if (event.newStatus === OrderStatus.CANCELLED_BY_CUSTOMER && event.technicianId) {
        const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);
        await this.notificationsService.notify({
          userId: technician.userId,
          notificationType: 'order_cancelled_by_customer',
          titleAr: 'العميل لغى الطلب',
          bodyAr: `طلب رقم ${event.orderNumber} اتلغى من العميل.`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        });
      }

      // الفني لغى طلب اتقبله بنفسه (بعد ما بدأ الشغل الإلغاء لازم يعدّي من الشكوى، مش هنا) —
      // كانت فجوة موثّقة صراحة، اتقفلت جنب OrdersService.technicianCancel().
      if (event.newStatus === OrderStatus.CANCELLED_BY_TECHNICIAN) {
        const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
        await this.notificationsService.notify({
          userId: customer.userId,
          notificationType: 'order_cancelled_by_technician',
          titleAr: 'الفني اعتذر عن الطلب',
          bodyAr: event.reason
            ? `طلب رقم ${event.orderNumber} — السبب: ${event.reason}. تقدر تحجز تاني وهنلاقيلك فني آخر.`
            : `طلب رقم ${event.orderNumber} اتلغى من الفني. تقدر تحجز تاني وهنلاقيلك فني آخر.`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/orders/${event.orderId}`,
        });
      }

      // العميل رد على عرض السعر (وافق أو رفض) — order-items.service.ts بيبعت الفرق في event.reason.
      // الفني محتاج يعرف يكمل الشغل بأي نطاق، فمفيش رسالة IN_PROGRESS عامة كفاية هنا.
      if (
        event.previousStatus === OrderStatus.AWAITING_QUOTE_APPROVAL &&
        event.newStatus === OrderStatus.IN_PROGRESS &&
        event.technicianId
      ) {
        const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);
        await this.notificationsService.notify({
          userId: technician.userId,
          notificationType: 'order_quote_decision',
          titleAr: 'العميل رد على عرض السعر',
          bodyAr: event.reason ?? `طلب رقم ${event.orderNumber} — راجع تفاصيل عرض السعر.`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        });
      }

      // إلغاء إداري (من لوحة الأدمن) بيوصل للطرفين مع سبب الإلغاء نفسه — مختلف عن
      // إلغاء العميل اللي بيوصل للفني بس، لأن هنا القرار جه من برّه الطرفين الاتنين.
      if (event.newStatus === OrderStatus.CANCELLED_BY_SYSTEM) {
        const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
        await this.notificationsService.notify({
          userId: customer.userId,
          notificationType: 'order_cancelled_by_admin',
          titleAr: 'طلبك اتلغى من الإدارة',
          bodyAr: event.reason ? `السبب: ${event.reason}` : 'تواصل مع الدعم لمزيد من التفاصيل.',
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/orders/${event.orderId}`,
        });

        if (event.technicianId) {
          const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);
          await this.notificationsService.notify({
            userId: technician.userId,
            notificationType: 'order_cancelled_by_admin',
            titleAr: 'طلب اتلغى من الإدارة',
            bodyAr: `طلب رقم ${event.orderNumber} اتلغى من الإدارة.`,
            referenceType: 'order',
            referenceId: event.orderId,
            deepLink: `/technician/orders/${event.orderId}`,
          });
        }
      }
    } catch (err) {
      this.logger.error(`فشل إشعار تغيير حالة الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
