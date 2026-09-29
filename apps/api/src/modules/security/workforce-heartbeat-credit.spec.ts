import { WorkforceActivityService } from './workforce-activity.service';

describe('workforce heartbeat credit', () => {
  function setup() {
    const query = jest.fn().mockResolvedValue([]);
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const service = new WorkforceActivityService(
      { query } as never,
      { update } as never,
      { getNumber: jest.fn().mockResolvedValue(300) } as never,
      {} as never,
    );
    return { service, query, update };
  }

  it('sends reset and timing limits to one atomic database upsert', async () => {
    const { service, query } = setup();
    await service.heartbeat('employee-id', true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (user_id, activity_date) DO UPDATE');
    expect(query.mock.calls[0][1].slice(3)).toEqual([true, 360, 300]);
  });

  it('sends a non-reset heartbeat without a read-then-write race', async () => {
    const { service, query } = setup();
    await service.heartbeat('employee-id');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1].slice(3)).toEqual([false, 360, 300]);
  });
});
