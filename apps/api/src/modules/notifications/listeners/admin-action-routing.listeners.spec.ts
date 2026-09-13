import { SupportTicketCreatedRoutingListener } from './support-ticket-created-routing.listener';
import { WarrantyClaimOpenedRoutingListener } from './warranty-claim-opened-routing.listener';
import { SupportTicketPriority } from '../../support/entities/support-ticket.entity';
import { NotificationRoutingService } from '../notification-routing.service';

describe('admin action routing listeners', () => {
  const routeToRole = jest.fn();

  beforeEach(() => {
    routeToRole.mockReset();
    routeToRole.mockResolvedValue(undefined);
  });

  it('routes a new support ticket to the support queue with its priority and deep link', async () => {
    const tickets = {
      findOne: jest.fn().mockResolvedValue({
        id: 'ticket-id',
        ticketNumber: 'TKT-100',
        priority: SupportTicketPriority.HIGH,
        subject: 'مشكلة في الحجز',
      }),
    };
    const listener = new SupportTicketCreatedRoutingListener(tickets as never, { routeToRole } as never);

    await listener.handle({ ticketId: 'ticket-id', ticketNumber: 'TKT-100' });

    expect(routeToRole).toHaveBeenCalledWith('support_ticket.created', expect.objectContaining({
      notificationType: 'support_ticket_created',
      bodyAr: 'عالية الأولوية - مشكلة في الحجز',
      deepLink: '/support-tickets/ticket-id',
    }));
  });

  it('routes an opened warranty claim only once to the warranty review queue', async () => {
    const claims = {
      findOne: jest.fn().mockResolvedValue({
        id: 'claim-id',
        defectDescription: 'تسريب مياه في المطبخ يحتاج معاينة سريعة.',
      }),
    };
    const listener = new WarrantyClaimOpenedRoutingListener(claims as never, { routeToRole } as never);

    await listener.handle({ claimId: 'claim-id', action: 'opened' });
    await listener.handle({ claimId: 'claim-id', action: 'reviewed', status: 'under_review' });

    expect(routeToRole).toHaveBeenCalledTimes(1);
    expect(routeToRole).toHaveBeenCalledWith('warranty_claim.opened', expect.objectContaining({
      notificationType: 'warranty_claim_opened',
      deepLink: '/warranty-claims',
    }));
  });

  it('always includes a super admin in an operational role route without duplicating recipients', async () => {
    const rules = { find: jest.fn().mockResolvedValue([{ roleName: 'finance', channels: ['in_app'] }]) };
    const dataSource = { query: jest.fn().mockResolvedValue([{ user_id: 'super-admin-id' }]) };
    const notifications = { notifyMultiChannel: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationRoutingService(rules as never, dataSource as never, notifications as never, {} as never);

    await service.routeToRole('payment.instapay_transfer_reported', {
      notificationType: 'payment_instapay_transfer_reported',
      titleAr: 'تحويل جديد',
      bodyAr: 'محتاج مراجعة',
    });

    expect(dataSource.query.mock.calls[0][0]).toContain("r.name IN ($1, 'super_admin')");
    expect(notifications.notifyMultiChannel).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMultiChannel).toHaveBeenCalledWith(expect.objectContaining({ userId: 'super-admin-id' }), ['in_app']);
  });
});
