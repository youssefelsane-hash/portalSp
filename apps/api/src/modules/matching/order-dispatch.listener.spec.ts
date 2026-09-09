import { OrderCreatedEvent } from '../../common/events/order-created.event';
import { OrderDispatchListener } from './order-dispatch.listener';
import { MatchingDispatchQueueClient } from './matching-dispatch-queue.client';
import { MatchingService } from './matching.service';

/**
 * ADR-0018 §3-4-6 — نقطة الدخول الموحّدة للتوزيع.
 *
 * **التغيير الجوهري**: التوزيع بقى **وظيفة طابور** بدل شغل جوّه طلب الـHTTP، عشان دفعة حجوزات
 * كبيرة تترصّ بدل ما تستنزف اتصالات القاعدة وترجّع 503 لعملاء حقيقيين (القياس الكامل في
 * `matching-dispatch-queue.client.ts`). الاختبارات دي بتقفل على التلات سلوكيات اللي بتخلي ده آمن.
 */
describe('OrderDispatchListener — التوزيع كوظيفة طابور (ADR-0018)', () => {
  const makeClient = (enqueueDispatch: jest.Mock) => ({ enqueueDispatch }) as unknown as MatchingDispatchQueueClient;

  it('بيحجز وظيفة توزيع، ومابينفّذش التوزيع في نفس العملية', async () => {
    const dispatchOrAutoConfirm = jest.fn();
    const enqueueDispatch = jest.fn().mockResolvedValue(true);
    const listener = new OrderDispatchListener(
      { dispatchOrAutoConfirm } as unknown as MatchingService,
      makeClient(enqueueDispatch),
    );

    await listener.handleOrderCreated(new OrderCreatedEvent('order-1'));

    expect(enqueueDispatch).toHaveBeenCalledWith('order-1');
    expect(dispatchOrAutoConfirm).not.toHaveBeenCalled();
  });

  it('الطابور واقع = التوزيع بينفّذ مباشرة — الطلب مايضيعش', async () => {
    const dispatchOrAutoConfirm = jest.fn().mockResolvedValue({ dispatched: 1 });
    const listener = new OrderDispatchListener(
      { dispatchOrAutoConfirm } as unknown as MatchingService,
      makeClient(jest.fn().mockResolvedValue(false)),
    );

    await listener.handleOrderCreated(new OrderCreatedEvent('order-2'));

    expect(dispatchOrAutoConfirm).toHaveBeenCalledWith('order-2');
  });

  it('فشل الطابور **وكمان** فشل التوزيع المباشر بيتلقّطوا — الـlistener مابيرميش برّه', async () => {
    const listener = new OrderDispatchListener(
      { dispatchOrAutoConfirm: jest.fn().mockRejectedValue(new Error('فشل مؤقت')) } as unknown as MatchingService,
      makeClient(jest.fn().mockResolvedValue(false)),
    );

    await expect(listener.handleOrderCreated(new OrderCreatedEvent('order-3'))).resolves.toBeUndefined();
  });
});
