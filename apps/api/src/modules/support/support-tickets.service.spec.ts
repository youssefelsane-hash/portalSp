import { SupportChannel, SupportTicketPriority } from './entities/support-ticket.entity';
import { SupportTicketsService } from './support-tickets.service';

describe('SupportTicketsService.create', () => {
  const ticket = {
    id: 'ticket-id',
    ticketNumber: 'TKT-2026-000001',
  };
  const manager = {
    query: jest.fn().mockResolvedValue([{ next_human_readable_number: ticket.ticketNumber }]),
    create: jest.fn().mockReturnValue(ticket),
    save: jest.fn().mockResolvedValue(ticket),
  };
  const events = { emit: jest.fn() };
  const dataSource = { transaction: jest.fn() };
  const users = { find: jest.fn() };
  const createService = () =>
    new SupportTicketsService({} as never, dataSource as never, {} as never, events as never, users as never);

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.transaction.mockImplementation((work: (transactionManager: typeof manager) => unknown) => work(manager));
  });

  it('persists the ticket before notifying the live admin dashboard', async () => {
    const service = createService();

    await expect(
      service.create(
        { sub: 'customer-user-id' } as never,
        { subject: 'مشكلة في تسجيل الدخول', category: 'account', channel: SupportChannel.APP },
      ),
    ).resolves.toEqual(ticket);

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'customer-user-id',
        ticketStatus: 'open',
        priority: SupportTicketPriority.MEDIUM,
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'support_ticket.created',
      expect.objectContaining({ ticketId: ticket.id, ticketNumber: ticket.ticketNumber }),
    );
  });

  it('does not announce a ticket when its transaction fails', async () => {
    const service = createService();
    dataSource.transaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.create(
        { sub: 'customer-user-id' } as never,
        { subject: 'مشكلة في التطبيق', category: 'technical', channel: SupportChannel.APP },
      ),
    ).rejects.toThrow('database unavailable');

    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('SupportTicketsService admin ticket owners', () => {
  const ticket = {
    id: 'ticket-id',
    userId: 'customer-user-id',
    createdAt: new Date(),
  };
  const tickets = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const users = { find: jest.fn() };
  const service = () =>
    new SupportTicketsService(tickets as never, {} as never, {} as never, {} as never, users as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns the ticket owner name for the admin list without exposing a raw id as the display value', async () => {
    tickets.find.mockResolvedValue([ticket]);
    users.find.mockResolvedValue([{ id: ticket.userId, fullName: 'Youssef Elsane' }]);

    await expect(service().listAllForAdmin()).resolves.toEqual([
      { ticket, ownerName: 'Youssef Elsane' },
    ]);
    expect(users.find).toHaveBeenCalledTimes(1);
  });

  it('keeps the owner name empty when the user account is no longer available', async () => {
    tickets.findOne.mockResolvedValue(ticket);
    users.find.mockResolvedValue([]);

    await expect(service().getForAdmin(ticket.id)).resolves.toEqual({ ticket, ownerName: null });
  });
});
