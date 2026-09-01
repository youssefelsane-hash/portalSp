import { RefundResolvedEvent } from '../../../common/events/refund-resolved.event';
import { RefundNotificationListener, refundNotificationCopy } from './refund-notification.listener';

describe('RefundNotificationListener', () => {
  const baseEvent: RefundResolvedEvent = {
    refundId: 'refund-id',
    orderId: 'order-id',
    orderNumber: 'ORD-2026-000123',
    customerProfileId: 'customer-profile',
    amountCents: 12550,
    status: 'completed',
    method: 'wallet_credit',
  };

  function makeListener() {
    const findByProfileIdOrThrow = jest.fn().mockResolvedValue({ userId: 'customer-user' });
    const notify = jest.fn().mockResolvedValue(undefined);
    const listener = new RefundNotificationListener(
      { findByProfileIdOrThrow } as never,
      { notify } as never,
    );
    return { listener, notify };
  }

  it('يبلغ العميل بالمبلغ المضاف إلى محفظته ويفتح الطلب', async () => {
    const { listener, notify } = makeListener();
    await listener.handle(baseEvent);

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'customer-user',
      notificationType: 'refund_completed',
      bodyAr: expect.stringContaining('125.50 ج.م'),
      referenceType: 'refund',
      referenceId: 'refund-id',
      deepLink: '/orders/order-id',
    }));
  });

  it('يوضح أن الاسترداد رجع إلى وسيلة الدفع الأصلية', () => {
    const copy = refundNotificationCopy({ ...baseEvent, method: 'original_method' });
    expect(copy.bodyAr).toContain('وسيلة الدفع الأصلية');
    expect(copy.bodyAr).toContain('ORD-2026-000123');
  });

  it('لا يخبر العميل كذبًا أن المبلغ اترد عند رفض البوابة', async () => {
    const { listener, notify } = makeListener();
    await listener.handle({ ...baseEvent, status: 'rejected', method: 'original_method' });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: 'refund_rejected',
      titleAr: 'تعذر إتمام استرداد المبلغ',
      bodyAr: expect.stringContaining('لم يتم استرداد'),
    }));
  });

  it('فشل الإشعار لا يكسر عملية الاسترداد الأصلية', async () => {
    const listener = new RefundNotificationListener(
      { findByProfileIdOrThrow: jest.fn().mockResolvedValue({ userId: 'customer-user' }) } as never,
      { notify: jest.fn().mockRejectedValue(new Error('push unavailable')) } as never,
    );

    await expect(listener.handle(baseEvent)).resolves.toBeUndefined();
  });
});
