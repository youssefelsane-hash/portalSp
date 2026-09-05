import { OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { ScheduleSlotReleaseListener } from './schedule-slot-release.listener';
import { TechnicianScheduleService } from './technician-schedule.service';

describe('ScheduleSlotReleaseListener', () => {
  const event = (status: OrderStatus) =>
    new OrderStatusChangedEvent('order-1', 'ORD-1', OrderStatus.ACCEPTED, status, 'customer-1', 'technician-1');

  it.each([
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_TECHNICIAN,
    OrderStatus.CANCELLED_BY_SYSTEM,
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
  ])('releases a booked slot when the order enters %s', async (status) => {
    const release = jest.fn(async () => undefined);
    const listener = new ScheduleSlotReleaseListener({ releaseSlotForOrder: release } as unknown as TechnicianScheduleService, { createQueryRunner: () => ({ connect: async () => undefined, query: async () => [{ locked: true }], release: async () => undefined }) } as never);

    await listener.handleOrderStatusChanged(event(status));

    expect(release).toHaveBeenCalledWith('order-1');
  });

  it('does not release a slot for an active execution transition', async () => {
    const release = jest.fn(async () => undefined);
    const listener = new ScheduleSlotReleaseListener({ releaseSlotForOrder: release } as unknown as TechnicianScheduleService, { createQueryRunner: () => ({ connect: async () => undefined, query: async () => [{ locked: true }], release: async () => undefined }) } as never);

    await listener.handleOrderStatusChanged(event(OrderStatus.TECHNICIAN_ON_WAY));

    expect(release).not.toHaveBeenCalled();
  });

  it('runs the durable recovery sweep with a bounded batch', async () => {
    const reconcile = jest.fn(async () => 3);
    const listener = new ScheduleSlotReleaseListener({
      reconcileReleasedSlots: reconcile,
    } as unknown as TechnicianScheduleService,
      { createQueryRunner: () => ({ connect: async () => undefined, query: async () => [{ locked: true }], release: async () => undefined }) } as never,
    );

    await expect(listener.sweep()).resolves.toBe(3);
    expect(reconcile).toHaveBeenCalledWith(25);
  });
});
