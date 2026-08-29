import { WarrantyClaimChangedEvent } from '../../../common/events/warranty-claim-changed.event';
import {
  WarrantyClaimNotificationListener,
  warrantyClaimNotificationCopy,
} from './warranty-claim-notification.listener';

describe('WarrantyClaimNotificationListener', () => {
  const statuses = [
    'under_review',
    'inspection_scheduled',
    'approved',
    'rejected',
    'repair_in_progress',
    'resolved',
    'closed',
  ];

  function makeListener() {
    const findByProfileIdOrThrow = jest.fn().mockResolvedValue({ userId: 'customer-user' });
    const notify = jest.fn().mockResolvedValue(undefined);
    const listener = new WarrantyClaimNotificationListener(
      { findByProfileIdOrThrow } as never,
      { notify } as never,
    );
    return { listener, findByProfileIdOrThrow, notify };
  }

  it.each(statuses)('يرسل تحديث %s إلى صاحب مطالبة الضمان', async (status) => {
    const { listener, notify } = makeListener();
    await listener.handle({
      claimId: 'claim-id',
      action: 'reviewed',
      customerProfileId: 'customer-profile',
      status,
    });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'customer-user',
      notificationType: `warranty_claim_${status}`,
      referenceType: 'warranty_claim',
      referenceId: 'claim-id',
      deepLink: '/warranties',
    }));
  });

  it('يعرض سبب الرفض وملاحظات الحل للعميل', () => {
    expect(warrantyClaimNotificationCopy({
      claimId: 'claim-id',
      action: 'reviewed',
      status: 'rejected',
      rejectionReason: 'العيب خارج نطاق التغطية',
    })?.bodyAr).toContain('العيب خارج نطاق التغطية');

    expect(warrantyClaimNotificationCopy({
      claimId: 'claim-id',
      action: 'reviewed',
      status: 'resolved',
      resolutionNotes: 'تمت إعادة العزل واختباره',
    })?.bodyAr).toBe('تمت إعادة العزل واختباره');
  });

  it('فتح العميل للمطالبة لا يرسل له إشعارًا عن فعله هو', async () => {
    const { listener, findByProfileIdOrThrow, notify } = makeListener();
    await listener.handle({ claimId: 'claim-id', action: 'opened' });

    expect(findByProfileIdOrThrow).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('فشل الإشعار لا يكسر قرار الضمان الأصلي', async () => {
    const listener = new WarrantyClaimNotificationListener(
      { findByProfileIdOrThrow: jest.fn().mockResolvedValue({ userId: 'customer-user' }) } as never,
      { notify: jest.fn().mockRejectedValue(new Error('push unavailable')) } as never,
    );
    const event: WarrantyClaimChangedEvent = {
      claimId: 'claim-id',
      action: 'reviewed',
      customerProfileId: 'customer-profile',
      status: 'approved',
    };

    await expect(listener.handle(event)).resolves.toBeUndefined();
  });
});
