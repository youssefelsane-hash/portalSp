import { AssistantOpportunityNotificationListener } from './assistant-opportunity-notification.listener';
import { AssistantOpportunityOfferedEvent } from '../../../common/events/assistant-opportunity-offered.event';

// §92 (طلب مالك مباشر — بلاغ حقيقي: ~20 إشعار "فرصة مساعدة جديدة" وصلوا دفعة واحدة لنفس الفني).
// راجع التعليق الكامل في الملف نفسه لسرد السبب: sweep دوري بيعالج لغاية 25 طلب في الجولة، وكل
// طلب مؤهّل بيعمل عرض+إشعار مستقل — لو نفس الفني مؤهّل لعدد كبير منها في نفس اللحظة، بياخدهم كلهم
// بلا تباعد. الإصلاح: تهدئة 5 دقايق لكل فني (العرض نفسه لسه بيتسجّل عادي، الإشعار بس اللي بيتأجّل).
describe('AssistantOpportunityNotificationListener — تهدئة الإشعار (§92)', () => {
  const makeListener = (recentNotification: unknown | null) => {
    const notificationsRepo = { findOne: jest.fn().mockResolvedValue(recentNotification) };
    const notificationsService = { notify: jest.fn().mockResolvedValue(undefined) };
    const techniciansService = {
      findByProfileIdOrThrow: jest.fn().mockResolvedValue({ id: 'tech-profile-1', userId: 'user-1' }),
    };
    const listener = new AssistantOpportunityNotificationListener(
      techniciansService as never,
      notificationsService as never,
      notificationsRepo as never,
    );
    return { listener, notificationsService, notificationsRepo };
  };

  it('بيبعت الإشعار عادي لو مفيش إشعار "فرصة مساعدة" حديث لنفس الفني', async () => {
    const { listener, notificationsService } = makeListener(null);
    await listener.handle(new AssistantOpportunityOfferedEvent('offer-1', 'order-1', 'tech-profile-1', 'ORD-000123'));

    expect(notificationsService.notify).toHaveBeenCalledTimes(1);
    expect(notificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationType: 'assistant_opportunity',
        bodyAr: expect.stringContaining('ORD-000123'),
      }),
    );
  });

  it('بيتخطّى الإشعار (بس مش العرض) لو الفني أخد إشعار "فرصة مساعدة" خلال آخر 5 دقايق', async () => {
    const { listener, notificationsService } = makeListener({ id: 'notification-old' });
    await listener.handle(new AssistantOpportunityOfferedEvent('offer-2', 'order-2', 'tech-profile-1', 'ORD-000456'));

    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('فشل غير متوقع أثناء الإشعار بيتسجّل في اللوج بلا ما يرمي (نفس نمط باقي listeners)', async () => {
    const { listener, notificationsService } = makeListener(null);
    notificationsService.notify.mockRejectedValueOnce(new Error('DB عابر'));

    await expect(
      listener.handle(new AssistantOpportunityOfferedEvent('offer-3', 'order-3', 'tech-profile-1', 'ORD-000789')),
    ).resolves.toBeUndefined();
  });
});
