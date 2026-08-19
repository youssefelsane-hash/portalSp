import { Queue } from 'bullmq';
import { getRedisUrl } from '../../config/redis-url.util';
import { OrderCreatedEvent } from '../../common/events/order-created.event';
import { OrderDispatchListener } from './order-dispatch.listener';
import { MATCHING_DISPATCH_QUEUE, deferredDispatchJobId } from './matching-dispatch.queue';
import { MatchingService } from './matching.service';

// اختبار حي ضد Redis حقيقي — بيثبت سلوك ADR-0009 بند 1-2 (P0-9): OrderDispatchListener لازم يأجّل
// بث المطابقة الفعلي (job مؤجّل في matching-dispatch queue) بدل ما ينادي dispatchNextRound() فورًا
// لما OrderCreatedEvent.dispatchDeferredUntil موجودة، وإلا يبث فورًا زي السلوك القديم بالحرف.
describe('OrderDispatchListener — تأجيل البث لطلب مجدول بعيد (regression P0-9)', () => {
  let queue: Queue;
  let dispatchNextRound: jest.Mock;
  let listener: OrderDispatchListener;

  const runId = Date.now().toString(36);
  const orderId = (label: string) => `test-order-${label}-${runId}`;

  beforeAll(() => {
    queue = new Queue(MATCHING_DISPATCH_QUEUE, { connection: { url: getRedisUrl() } });
  });

  beforeEach(() => {
    dispatchNextRound = jest.fn().mockResolvedValue({ dispatched: 1 });
    // ADR-0017 بند 7 — isFarFutureOrder بقى الفحص الأول قبل حتى منطق التأجيل بتاع ADR-0009. مزوّرة
    // بـfalse هنا عشان الاختبارات دي تفضل تختبر بالظبط سلوك ADR-0009 (التأجيل)، مش المسار الجديد.
    const isFarFutureOrder = jest.fn().mockResolvedValue(false);
    listener = new OrderDispatchListener({ dispatchNextRound, isFarFutureOrder } as unknown as MatchingService, queue);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('dispatchDeferredUntil مستقبلية: بيجدول job مؤجّل بدل ما يبث فورًا — كان الثغرة', async () => {
    const id = orderId('a');
    const deferredUntil = new Date(Date.now() + 60_000);

    await listener.handleOrderCreated(new OrderCreatedEvent(id, deferredUntil));

    expect(dispatchNextRound).not.toHaveBeenCalled();

    const job = await queue.getJob(deferredDispatchJobId(id));
    expect(job).toBeDefined();
    expect(job?.data).toEqual({ orderId: id });
    const state = await job?.getState();
    expect(state).toBe('delayed');
    // delay المخزّن في opts لازم يقارب الفرق المحسوب (نسمح بهامش تنفيذ بسيط بالمللي ثانية)
    expect(job?.opts.delay).toBeGreaterThan(55_000);
    expect(job?.opts.delay).toBeLessThanOrEqual(60_000);
  });

  it('مفيش dispatchDeferredUntil (طلب فوري/قريب): بيبث فورًا زي القديم بالحرف — مفيش job في الطابور', async () => {
    const id = orderId('b');

    await listener.handleOrderCreated(new OrderCreatedEvent(id));

    expect(dispatchNextRound).toHaveBeenCalledWith(id);
    const job = await queue.getJob(deferredDispatchJobId(id));
    expect(job).toBeUndefined();
  });

  it('dispatchDeferredUntil في الماضي (دفاعي — مايفترضش يحصل فعليًا): بيبث فورًا مش بيجدول job', async () => {
    const id = orderId('c');
    const pastDeferredUntil = new Date(Date.now() - 60_000);

    await listener.handleOrderCreated(new OrderCreatedEvent(id, pastDeferredUntil));

    expect(dispatchNextRound).toHaveBeenCalledWith(id);
    const job = await queue.getJob(deferredDispatchJobId(id));
    expect(job).toBeUndefined();
  });

  // ADR-0017 بند 7 — طلب "بعيد" لازم يتأكد تلقائيًا فورًا (autoConfirmFutureOrder)، بلا انتظار
  // قرب الموعد (لا تأجيل قائمة ولا بث عادي خالص) — حتى لو dispatchDeferredUntil موجودة كمان
  // (ADR-0009)، isFarFutureOrder لازم يسبقها ويمنعها تمامًا.
  it('طلب بعيد (isFarFutureOrder=true): بيتأكد تلقائيًا فورًا — مفيش بث ولا job مؤجّل خالص', async () => {
    const id = orderId('d');
    const autoConfirmFutureOrder = jest.fn().mockResolvedValue({ dispatched: 1 });
    const farFutureListener = new OrderDispatchListener(
      {
        dispatchNextRound,
        autoConfirmFutureOrder,
        isFarFutureOrder: jest.fn().mockResolvedValue(true),
      } as unknown as MatchingService,
      queue,
    );

    await farFutureListener.handleOrderCreated(new OrderCreatedEvent(id, new Date(Date.now() + 60_000)));

    expect(autoConfirmFutureOrder).toHaveBeenCalledWith(id);
    expect(dispatchNextRound).not.toHaveBeenCalled();
    const job = await queue.getJob(deferredDispatchJobId(id));
    expect(job).toBeUndefined();
  });
});
