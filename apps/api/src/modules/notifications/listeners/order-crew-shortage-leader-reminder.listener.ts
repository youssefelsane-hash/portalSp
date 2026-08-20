import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ORDER_CREW_SHORTAGE_ESCALATED_EVENT,
  OrderCrewShortageEscalatedEvent,
} from '../../../common/events/order-crew-shortage-escalated.event';
import { Order } from '../../orders/entities/order.entity';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

// تذكير القائد بنقص طاقمه (docs/08 §35.17) — نفس حدث تصعيد الأدمن بالظبط (ORDER_CREW_SHORTAGE_
// ESCALATED_EVENT، §35.5)، مش sweep/حدث جديد. القائد نفسه لازم يعرف طاقمه لسه ناقص قبل الموعد
// بمهلة قليلة، مش الأدمن بس — استمعان مستقلان لنفس الحدث (نفس نمط EmergencyOrderRoutingListener
// وباقي المستمعين اللي كل واحد بيرد على نفس الحدث بمسؤولية مختلفة تمامًا). `Order` مسجّلة أصلاً
// في NotificationsModule (نفس نمط matching.module.ts — كيان بس بلا استيراد OrdersModule كامل).
@Injectable()
export class OrderCrewShortageLeaderReminderListener {
  private readonly logger = new Logger(OrderCrewShortageLeaderReminderListener.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_CREW_SHORTAGE_ESCALATED_EVENT)
  async handle(event: OrderCrewShortageEscalatedEvent): Promise<void> {
    try {
      const order = await this.orders.findOne({ where: { id: event.orderId } });
      if (!order?.technicianId) return;

      const leader = await this.techniciansService.findByProfileIdOrThrow(order.technicianId);

      const parts: string[] = [];
      if (event.missingTechnicians > 0) parts.push(`${event.missingTechnicians} فني`);
      if (event.missingAssistants > 0) parts.push(`${event.missingAssistants} مساعد`);
      const missingText = parts.join(' و');

      await this.notificationsService.notify({
        userId: leader.userId,
        notificationType: 'crew_shortage_leader_reminder',
        titleAr: `طاقمك لسه ناقص: ${event.orderNumber}`,
        bodyAr: `موعد الطلب قرّب ولسه ناقصك ${missingText} — كمّل الطاقم دلوقتي من شاشة الطلب.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/technician/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل تذكير القائد بنقص طاقم ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
