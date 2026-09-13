import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_PREPAID_MID_FLIGHT_EVENT,
  OrderPrepaidMidFlightEvent,
} from '../../../common/events/order-prepaid-mid-flight.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

/**
 * ADR-0091 §8 — «الفلوس اتدفعت أونلاين يـreflect على طول عند الصنايعي» (طلب مالك).
 *
 * شاشة الفني بتحسب المطلوب تحصيله من جدول `payments` فبتبان صح أول ما يفتحها، لكن "على طول"
 * معناها إشعار مش انتظار refresh.
 *
 * **بلا أي رقم فلوس** (docs/08 §60.2) — الفني محتاج يعرف إنه مش هيحصّل كاش، مش كام العميل دفع.
 */
@Injectable()
export class OrderPrepaidMidFlightNotificationListener {
  private readonly logger = new Logger(OrderPrepaidMidFlightNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_PREPAID_MID_FLIGHT_EVENT)
  async handle(event: OrderPrepaidMidFlightEvent): Promise<void> {
    // دفع جزئي وسط الشغل لسه بيسيب كاش مطلوب، وإشعار "مش هتحصّل حاجة" ساعتها غلط صريح.
    if (!event.technicianId || !event.fullyCoveredOnline) return;
    try {
      const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);
      await this.notificationsService.notify({
        userId: technician.userId,
        notificationType: 'order_prepaid_online',
        titleAr: 'العميل دفع أونلاين ✅',
        bodyAr: `طلب ${event.orderNumber} اتدفع أونلاين بالكامل — مش مطلوب منك تحصيل كاش.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار الدفع المبكر ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
