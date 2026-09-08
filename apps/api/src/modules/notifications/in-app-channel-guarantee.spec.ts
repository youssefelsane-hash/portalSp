import { NotificationChannel } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationTypeConfigService } from './notification-type-config.service';

/**
 * **`in_app` مضمونة دايمًا — الصف ده هو الأثر الوحيد جوّه التطبيق.**
 *
 * ## البَقّة الحقيقية اللي السبيك ده بيقفلها (بلاغ مالك: «الإشعارات ما بقتش بتتبعت خالص»)
 *
 * `notifyMultiChannel` موصوفة في الكود بالحرف: «in_app مضمون دايمًا + push/sms إضافي». الضمان
 * ده **مكانش متنفّذ في أي مكان** — `notify()` بلا قناة صريحة بتقرا `default_channels` من
 * `notification_type_configs` وبتستخدمها **كبديل** مش كإضافة.
 *
 * على قاعدة التطوير الحقيقية: **٣٦ نوع من ٣٧** كانوا `["push"]` بالظبط، بلا `in_app` — من ضمنهم
 * `order_accepted` و`order_awaiting_quote_approval` و`order_quote_decision`. النتيجة:
 *
 *   • مفيش أي صف `in_app` بيتعمل ⇒ صندوق الإشعارات في التطبيق فاضي تمامًا،
 *   • والـpush في بيئة من غير مزوّد حقيقي بيفشل ⇒ **مفيش أي أثر للإشعار في أي مكان**.
 *
 * وده بالظبط اللي المالك وصفه: «حتى لما الطلب بيتقبل ما لهاش أي أصل».
 *
 * القاعدة الصح: `in_app` **سجل**، والقنوات التانية **توصيل**. الأدمن يقدر يزوّد قنوات توصيل،
 * ومايقدرش يشيل السجل.
 */
describe('ضمان قناة in_app', () => {
  function buildService(configuredChannels: string[] | null): NotificationsService {
    const service = Object.create(NotificationsService.prototype) as NotificationsService;
    Object.assign(service, {
      typeConfigs: {
        findOne: async () => (configuredChannels ? { defaultChannels: configuredChannels } : null),
      },
    });
    return service;
  }

  const resolve = (svc: NotificationsService, type: string): Promise<NotificationChannel[]> =>
    (svc as unknown as { resolveConfiguredChannels(t: string): Promise<NotificationChannel[]> })
      .resolveConfiguredChannels(type);

  it('إعداد push بس لازم يفضل معاه in_app — ده كان سبب اختفاء كل الإشعارات', async () => {
    const channels = await resolve(buildService(['push']), 'order_accepted');
    expect(channels).toContain(NotificationChannel.IN_APP);
    expect(channels).toContain(NotificationChannel.PUSH);
  });

  it('نوع بلا صف إعدادات = in_app بس (السلوك الافتراضي زي ما هو)', async () => {
    expect(await resolve(buildService(null), 'نوع_مالوش_إعدادات')).toEqual([NotificationChannel.IN_APP]);
  });

  it('إعداد فيه in_app أصلاً مابيتكررش', async () => {
    const channels = await resolve(buildService(['in_app', 'push', 'in_app']), 'order_created');
    expect(channels.filter((c) => c === NotificationChannel.IN_APP)).toHaveLength(1);
  });

  it('قيمة قناة غير معروفة بتتجاهل من غير ما تكسر الإشعار', async () => {
    const channels = await resolve(buildService(['قناة_مخترعة', 'push']), 'order_created');
    expect(channels).toEqual([NotificationChannel.PUSH, NotificationChannel.IN_APP].sort());
  });

  /**
   * **الوجه التاني من نفس القاعدة (بلاغ مالك تاني: «الإشعارات بقت بتيجي مرتين»).**
   *
   * الصف بيتعمل لكل قناة على حدة، و`listMine` مكانتش بتفلتر بالقناة خالص. الشكل ده مكانش باين
   * قبل كده **بالصدفة**: ٣٦ نوع من ٣٧ كانوا `["push"]` بس فمافيش غير صف واحد. أول ما `in_app`
   * رجعت بقى كل حدث بيبان مرتين — نفس الإصلاح كشف العيب اللي تحته.
   */
  it('الصندوق بيقرا صفوف in_app بس — صف التوصيل مش عنصر في القايمة', async () => {
    const captured: Record<string, unknown>[] = [];
    const service = Object.create(NotificationsService.prototype) as NotificationsService;
    Object.assign(service, {
      notifications: {
        findAndCount: async ({ where }: { where: Record<string, unknown> }) => {
          captured.push(where);
          return [[], 0];
        },
        count: async ({ where }: { where: Record<string, unknown> }) => {
          captured.push(where);
          return 0;
        },
      },
      markDelivered: async () => 0,
    });

    await service.listMine('user-1', { page: 1, perPage: 20, unreadOnly: false });
    await service.unreadCount('user-1');

    expect(captured).toHaveLength(2);
    for (const where of captured) {
      expect(where.channel).toBe(NotificationChannel.IN_APP);
    }
  });

  /** نفس القاعدة عند الحفظ: الأدمن مايقدرش يشيل السجل من الشاشة. */
  it('حفظ إعدادات بلا in_app بيرجّعها تلقائيًا بدل ما يقفل الإشعار', () => {
    const normalized = NotificationTypeConfigService.normalizeChannels([NotificationChannel.PUSH]);
    expect(normalized).toContain(NotificationChannel.IN_APP);
    expect(normalized).toContain(NotificationChannel.PUSH);
  });
});
