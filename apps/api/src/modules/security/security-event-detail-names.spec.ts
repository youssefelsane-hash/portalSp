import { SecurityEventsService } from './security-events.service';

describe('security event detail names', () => {
  it('shows the actor and target names without replacing their audit IDs', async () => {
    const event = {
      id: 'event-id',
      actorUserId: 'actor-id',
      targetUserId: 'target-id',
    };
    const query = jest.fn().mockResolvedValue([
      { id: 'actor-id', full_name: 'موظف الاختبار' },
      { id: 'target-id', full_name: 'العميل' },
    ]);
    const service = new SecurityEventsService(
      { query } as never,
      { findOne: jest.fn().mockResolvedValue(event) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const detail = await service.getDetail(event.id);

    expect(detail).toMatchObject({
      actorUserId: 'actor-id',
      actorName: 'موظف الاختبار',
      targetUserId: 'target-id',
      targetName: 'العميل',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM users'), [['actor-id', 'target-id']]);
  });
});
