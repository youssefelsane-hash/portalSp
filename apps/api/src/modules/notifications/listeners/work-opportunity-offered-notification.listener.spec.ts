import { WorkOpportunityOfferedEvent } from '../../../common/events/work-opportunity-offered.event';
import { WorkOpportunityOfferedNotificationListener } from './work-opportunity-offered-notification.listener';

describe('WorkOpportunityOfferedNotificationListener', () => {
  it('يذكر تاريخ الطلب الحقيقي بدل كلمة النهاردة الثابتة', async () => {
    const notifyMultiChannel = jest.fn().mockResolvedValue(undefined);
    const listener = new WorkOpportunityOfferedNotificationListener(
      { findByProfileIdOrThrow: jest.fn().mockResolvedValue({ userId: 'tech-user' }) } as never,
      { notifyMultiChannel } as never,
    );

    await listener.handle(
      new WorkOpportunityOfferedEvent(
        'opportunity-id',
        'order-id',
        'ORD-2026-000123',
        'technician-id',
        'assignment',
        'MEANINGFUL',
        new Date('2026-09-23T00:00:00Z'),
      ),
    );

    const payload = notifyMultiChannel.mock.calls[0][0] as { bodyAr: string };
    expect(payload.bodyAr).toContain('سبتمبر');
    expect(payload.bodyAr).toContain('٢٠٢٦');
    expect(payload.bodyAr).not.toContain('النهاردة');
  });
});
