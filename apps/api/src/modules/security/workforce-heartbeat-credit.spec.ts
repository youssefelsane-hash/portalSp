import { WorkforceActivityService } from './workforce-activity.service';

describe('workforce heartbeat credit', () => {
  function setup(gapSeconds: number) {
    const previous = new Date(Date.now() - gapSeconds * 1000).toISOString();
    const query = jest.fn()
      .mockResolvedValueOnce([{ last_activity_at: previous }])
      .mockResolvedValueOnce([]);
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const service = new WorkforceActivityService(
      { query } as never,
      { update } as never,
      { getNumber: jest.fn().mockResolvedValue(300) } as never,
      {} as never,
    );
    return { service, query, update };
  }

  it('resuming after idle resets the clock without crediting the gap', async () => {
    const { service, query } = setup(120);
    await service.heartbeat('employee-id', true);
    expect(query.mock.calls[1][1][3]).toBe(0);
  });

  it('credits a full five-minute window when there was interaction', async () => {
    const { service, query } = setup(300);
    await service.heartbeat('employee-id');
    expect(query.mock.calls[1][1][3]).toBe(300);
  });

  it('allows network delay without crediting more than five minutes', async () => {
    const { service, query } = setup(350);
    await service.heartbeat('employee-id');
    expect(query.mock.calls[1][1][3]).toBe(300);
  });

  it('does not credit a gap beyond the allowed heartbeat delay', async () => {
    const { service, query } = setup(400);
    await service.heartbeat('employee-id');
    expect(query.mock.calls[1][1][3]).toBe(0);
  });
});
