import { OrderCreatedEvent } from '../../common/events/order-created.event';
import { OrderDispatchListener } from './order-dispatch.listener';
import { MatchingService } from './matching.service';

// ADR-0018 §3-4-6 — آلية تأجيل ADR-0009 (P0-9) اتشالت من هنا (بقت ميتة عمليًا بعد التصحيح، راجع
// التعليق التفصيلي في order-dispatch.listener.ts). المسار الوحيد دلوقتي: كل OrderCreatedEvent
// بينادي MatchingService.dispatchOrAutoConfirm() مباشرة، اللي بتفرّق طوارئ/مجدول داخليًا. الاختبار
// ده بقى وحدة بسيطة (mocks بس، مفيش Redis حي مطلوب) بيثبت النداء المباشر + إن أي استثناء بيتلقّط
// (لوج تحذير) بدل ما يكسر الـevent listener (باقي الـlisteners التانية لازم تفضل تشتغل).
describe('OrderDispatchListener — نقطة الدخول الموحّدة (ADR-0018)', () => {
  it('بينادي dispatchOrAutoConfirm بمعرّف الطلب مباشرة', async () => {
    const dispatchOrAutoConfirm = jest.fn().mockResolvedValue({ dispatched: 1 });
    const listener = new OrderDispatchListener({ dispatchOrAutoConfirm } as unknown as MatchingService);

    await listener.handleOrderCreated(new OrderCreatedEvent('order-1'));

    expect(dispatchOrAutoConfirm).toHaveBeenCalledWith('order-1');
  });

  it('استثناء من dispatchOrAutoConfirm بيتلقّط جوّه الـlistener ومبيتلقيش برّه', async () => {
    const dispatchOrAutoConfirm = jest.fn().mockRejectedValue(new Error('فشل مؤقت'));
    const listener = new OrderDispatchListener({ dispatchOrAutoConfirm } as unknown as MatchingService);

    await expect(listener.handleOrderCreated(new OrderCreatedEvent('order-2'))).resolves.toBeUndefined();
  });
});
