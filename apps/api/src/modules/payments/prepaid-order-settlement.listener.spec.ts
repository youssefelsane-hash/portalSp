import { PrepaidOrderSettlementListener } from './prepaid-order-settlement.listener';
import { OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { PaymentsService } from './payments.service';

// اختبار وحدة نقي (بدون DB) — بيثبت سلوك الاستماع نفسه (ADR-0015): بينادي settleAlreadyPaidOrder()
// بس لـWORK_COMPLETED، وبيبلع أي استثناء بدل ما يوقع الـevent loop (نفس فلسفة onModuleInit's
// catch في order-auto-cancel.service.ts) — المنطق المالي الفعلي مختبر حيًا في
// prepaid-order-settlement.spec.ts.
describe('PrepaidOrderSettlementListener', () => {
  function makeEvent(newStatus: OrderStatus): OrderStatusChangedEvent {
    return new OrderStatusChangedEvent('order-1', 'ORD-1', OrderStatus.IN_PROGRESS, newStatus, 'cust-1', 'tech-1');
  }

  it('newStatus=WORK_COMPLETED — بينادي settleAlreadyPaidOrder() بالـorderId الصح', async () => {
    const settleSpy = jest.fn(async () => undefined);
    const listener = new PrepaidOrderSettlementListener({ settleAlreadyPaidOrder: settleSpy } as unknown as PaymentsService);

    await listener.handleOrderStatusChanged(makeEvent(OrderStatus.WORK_COMPLETED));

    expect(settleSpy).toHaveBeenCalledWith('order-1');
  });

  it('أي newStatus تاني — مابينادش settleAlreadyPaidOrder() خالص', async () => {
    const settleSpy = jest.fn(async () => undefined);
    const listener = new PrepaidOrderSettlementListener({ settleAlreadyPaidOrder: settleSpy } as unknown as PaymentsService);

    await listener.handleOrderStatusChanged(makeEvent(OrderStatus.COMPLETED));
    await listener.handleOrderStatusChanged(makeEvent(OrderStatus.CANCELLED_BY_CUSTOMER));

    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('لو settleAlreadyPaidOrder() رمت استثناء — الـlistener بيبلعه، مايرميش تاني', async () => {
    const settleSpy = jest.fn(async () => {
      throw new Error('DB عابر مثلاً');
    });
    const listener = new PrepaidOrderSettlementListener({ settleAlreadyPaidOrder: settleSpy } as unknown as PaymentsService);

    await expect(listener.handleOrderStatusChanged(makeEvent(OrderStatus.WORK_COMPLETED))).resolves.toBeUndefined();
  });

  it('sweep يعيد بناء الحدث من الحالة الدائمة بدفعة محدودة', async () => {
    const reconcile = jest.fn(async () => 2);
    const listener = new PrepaidOrderSettlementListener({
      reconcilePrepaidWorkCompleted: reconcile,
    } as unknown as PaymentsService);

    await expect(listener.sweep()).resolves.toBe(2);
    expect(reconcile).toHaveBeenCalledWith(25);
  });
});
