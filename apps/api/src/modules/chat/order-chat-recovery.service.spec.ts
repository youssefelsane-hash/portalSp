import { OrderChatRecoveryService } from './order-chat-recovery.service';

describe('OrderChatRecoveryService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('recovers missing thread creation and close scheduling in one bounded sweep', async () => {
    const query = jest.fn().mockResolvedValue([
      { id: 'accepted-order', customer_id: 'customer', technician_id: 'technician', action: 'create' },
      { id: 'completed-order', customer_id: 'customer', technician_id: 'technician', action: 'schedule_close' },
    ]);
    const createThreadForOrder = jest.fn().mockResolvedValue({});
    const scheduleCloseForOrder = jest.fn().mockResolvedValue(undefined);
    const service = new OrderChatRecoveryService(
      { query } as never,
      { createThreadForOrder, scheduleCloseForOrder } as never,
    );

    await expect(service.sweep(100)).resolves.toBe(2);
    expect(query.mock.calls[0][1]).toEqual([25]);
    expect(createThreadForOrder).toHaveBeenCalledWith('accepted-order', 'customer', 'technician');
    expect(scheduleCloseForOrder).toHaveBeenCalledWith('completed-order');
  });

  it('unrefs and clears the recurring timer', () => {
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setInterval>;
    jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const service = new OrderChatRecoveryService({} as never, {} as never);

    service.onModuleInit();
    service.onModuleDestroy();

    expect(unref).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(timer);
  });
});
