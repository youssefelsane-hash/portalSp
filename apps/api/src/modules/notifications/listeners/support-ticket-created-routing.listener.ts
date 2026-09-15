import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SUPPORT_TICKET_CREATED_EVENT,
  SupportTicketCreatedEvent,
} from '../../../common/events/support-ticket-created.event';
import { SupportTicket, SupportTicketPriority } from '../../support/entities/support-ticket.entity';
import { NotificationRoutingService } from '../notification-routing.service';

const PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  [SupportTicketPriority.LOW]: 'منخفضة',
  [SupportTicketPriority.MEDIUM]: 'متوسطة',
  [SupportTicketPriority.HIGH]: 'عالية',
  [SupportTicketPriority.URGENT]: 'عاجلة',
};

/** يوصل التذكرة الجديدة لفريق الدعم بعد نجاح حفظها، من غير ما يؤثر فشل الإشعار على إنشاء التذكرة. */
@Injectable()
export class SupportTicketCreatedRoutingListener {
  private readonly logger = new Logger(SupportTicketCreatedRoutingListener.name);

  constructor(
    @InjectRepository(SupportTicket) private readonly tickets: Repository<SupportTicket>,
    private readonly routingService: NotificationRoutingService,
  ) {}

  @OnEvent(SUPPORT_TICKET_CREATED_EVENT)
  async handle(event: SupportTicketCreatedEvent): Promise<void> {
    try {
      const ticket = await this.tickets.findOne({ where: { id: event.ticketId } });
      if (!ticket) return;

      await this.routingService.routeToRole(SUPPORT_TICKET_CREATED_EVENT, {
        notificationType: 'support_ticket_created',
        titleAr: `تذكرة دعم جديدة: ${ticket.ticketNumber}`,
        bodyAr: `${PRIORITY_LABEL[ticket.priority]} الأولوية - ${ticket.subject}`,
        referenceType: 'support_ticket',
        referenceId: ticket.id,
        deepLink: `/support-tickets/${ticket.id}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار التذكرة ${event.ticketId}`, err instanceof Error ? err.stack : err);
    }
  }
}
