import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import { OrderStatus } from '../../orders/entities/order.entity';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationWorkflowService } from '../notification-workflow.service';
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
  // ADR-0015 — طلب كان مدفوع مسبقًا (كارت/InstaPay قبل التوزيع) واتضاف عليه بند إضافي بعد
  // الدفع — الفرق (الدلتا) لازم يترحصّل قبل ما الطلب يقفل. السبب الدقيق (المبلغ) موجود في
  // event.reason، بس مش متسجّل هنا (القاموس ده رسالة عامة بس) — التفاصيل في تفاصيل الطلب نفسه.
  [OrderStatus.AWAITING_PAYMENT]: {
    title: 'مبلغ إضافي مطلوب',
    body: 'اتضاف بند إضافي على طلبك بعد الدفع — راجع طلبك وادفع المبلغ المتبقي.',
  },
  // سياسة إلغاء الفني (docs/10) — إشعار awaiting_technician_reselection مغطّى بالكامل عبر
  // TechnicianCancellationNotificationListener (يسمع TECHNICIAN_ORDER_CANCELLED_EVENT مباشرة،
  // multi-channel + توجيه أدمن) — مش هنا، عشان نتفادى إشعار مكرر لنفس الحدث من مكانين.
};

@Injectable()
export class OrderStatusNotificationListener {
  private readonly logger = new Logger(OrderStatusNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      const customerMessage = CUSTOMER_MESSAGES[event.newStatus];
      if (customerMessage) {
        const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);

        // أول استخدام حقيقي لمحرك الإشعارات الجديد (ADR-0012، docs/08 §15) — عرض سعر يستنى
        // موافقة العميل هو أنسب مثال action_required موجود بالفعل: العميل لازم يتخذ قرار فعلي
        // (موافقة/رفض) قبل ما الشغل يكمل، مش مجرد معلومة. الـworkflow بيتعمل قبل الإرسال الأول
        // عشان حتى الإشعار الأول (مش بس التذكيرات) يترتبط بيه (workflow_id) — تتبّع كامل. تذكير
        // كل ساعة (إعداد قابل للتعديل) لحد ما يتحل — راجع الفرع تحت (previousStatus=AWAITING_QUOTE_APPROVAL) لنقطة الحل.
        const workflow =
          event.newStatus === OrderStatus.AWAITING_QUOTE_APPROVAL
            ? await this.workflowService.create({
                userId: customer.userId,
                notificationType: 'order_quote_pending_approval',
                titleAr: customerMessage.title,
                bodyAr: customerMessage.body,
                entityType: 'order',
                entityId: event.orderId,
                deepLink: `/orders/${event.orderId}`,
                actionType: 'approve_quote',
              })
            : null;

        await this.notificationsService.notify({
          userId: customer.userId,
          notificationType: `order_${event.newStatus}`,
          titleAr: customerMessage.title,
          bodyAr: customerMessage.body,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/orders/${event.orderId}`,
          workflowId: workflow?.id,
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

      // ملحوظة: OrderStatus.CANCELLED_BY_TECHNICIAN بقى غير قابل للوصول من OrdersService.technicianCancel()
      // بعد سياسة إلغاء الفني الكاملة (docs/10) — الفني دلوقتي بيرجّع الطلب searching_technician
      // (إعادة مطابقة) أو awaiting_technician_reselection (يستنى اختيار العميل)، مش يلغيه نهائي.
      // الإشعار المقابل بقى في notifications/listeners/technician-cancellation-notification.listener.ts
      // (حدث مخصوص TECHNICIAN_ORDER_CANCELLED_EVENT، مش الحدث العام ده) — الفرع القديم هنا اتشال
      // لأنه بقى كود ميت فعليًا (مفيش أي مكان بيصدّر الحالة دي تاني)، الـenum نفسه فضل موجود في
      // order-state-machine.ts لتوافق البيانات التاريخية بس.

      // العميل خرج من awaiting_quote_approval (وافق/رفض/لغى الطلب بالكامل) — يوقف تذكيرات
      // action_required بتاعة عرض السعر ده مهما كانت الوجهة التالية، مش بس مسار الموافقة العادي.
      if (event.previousStatus === OrderStatus.AWAITING_QUOTE_APPROVAL && event.newStatus !== OrderStatus.AWAITING_QUOTE_APPROVAL) {
        await this.workflowService.resolve('order', event.orderId, 'approve_quote');
      }

      // الطلب خرج من accepted (الفني بدأ يتحرك فعليًا، أو اتلغى/اتحول لإعادة اختيار) — تذكيرات
      // scheduled_job بتاعة الموعد المستقبلي مالهاش معنى بعد كده (ADR-0012، docs/08 §15).
      if (event.previousStatus === OrderStatus.ACCEPTED && event.newStatus !== OrderStatus.ACCEPTED) {
        await this.workflowService.resolve('order', event.orderId, undefined, 'order_assigned_scheduled');
      }

      // العميل خرج من awaiting_technician_reselection (اختار فني بديل عبر request-rematch، أو
      // لغى الطلب بالكامل) — يوقف تذكيرات action_required بتاعة اختيار الفني البديل مهما كانت
      // الوجهة التالية (سياسة إلغاء الفني، docs/10 + ADR-0012).
      if (
        event.previousStatus === OrderStatus.AWAITING_TECHNICIAN_RESELECTION &&
        event.newStatus !== OrderStatus.AWAITING_TECHNICIAN_RESELECTION
      ) {
        await this.workflowService.resolve('order', event.orderId, 'select_replacement_technician');
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
