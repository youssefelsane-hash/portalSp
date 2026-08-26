import { RATING_SUBMITTED_EVENT, RatingSubmittedEvent } from '../../../common/events/rating-submitted.event';
import { RatingType } from '../../ratings/entities/rating.entity';
import { NotificationsService } from '../notifications.service';
import { RatingSubmittedNotificationListener } from './rating-submitted-notification.listener';

// docs/08 §68 (طلب مالك صريح): «التقييم ده يظهر للأدمن فقط، يعني العميل المفروض ما يعرفش هو
// بيتقيّم». الإشعار ده كان بيبعت للعميل بالحرف «اتقيّمت بـ N من 5 نجوم» — تسريب مباشر.
describe('إشعار التقييم — الفني لما يقيّم العميل، العميل مايتبلّغش (docs/08 §68)', () => {
  function makeListener() {
    const notify = jest.fn().mockResolvedValue(undefined);
    const listener = new RatingSubmittedNotificationListener({ notify } as unknown as NotificationsService);
    return { listener, notify };
  }

  it('تقييم الفني للعميل: صفر إشعارات للعميل', async () => {
    const { listener, notify } = makeListener();
    await listener.handleRatingSubmitted(
      new RatingSubmittedEvent('r1', 'o1', RatingType.TECHNICIAN_TO_CUSTOMER, 2, 'customer-user'),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('تقييم العميل للفني: الفني لسه بيتبلّغ زي ما هو (مفيش انحدار)', async () => {
    const { listener, notify } = makeListener();
    await listener.handleRatingSubmitted(
      new RatingSubmittedEvent('r2', 'o2', RatingType.CUSTOMER_TO_TECHNICIAN, 5, 'tech-user'),
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    expect(payload.userId).toBe('tech-user');
    expect(payload.notificationType).toBe('rating_received');
    expect(payload.deepLink).toBe('/technician/orders/o2');
  });

  it('فشل الإشعار مابيرميش خطأ برّه (مايكسرش التقييم نفسه)', async () => {
    const notify = jest.fn().mockRejectedValue(new Error('كسر مؤقت'));
    const listener = new RatingSubmittedNotificationListener({ notify } as unknown as NotificationsService);
    await expect(
      listener.handleRatingSubmitted(new RatingSubmittedEvent('r3', 'o3', RatingType.CUSTOMER_TO_TECHNICIAN, 4, 'u')),
    ).resolves.toBeUndefined();
  });

  it('اسم الحدث ثابت — الـlistener متسجّل على نفس المفتاح اللي RatingsService بتصدره', () => {
    expect(RATING_SUBMITTED_EVENT).toBe('rating.submitted');
  });
});
