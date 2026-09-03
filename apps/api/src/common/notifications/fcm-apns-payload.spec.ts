import { ConfigService } from '@nestjs/config';
import { MulticastMessage } from 'firebase-admin/messaging';
import { NotificationChannel } from '../../modules/notifications/entities/notification.entity';
import { NotificationPriorityTier } from '../../modules/notifications/entities/notification-type-config.entity';
import { FcmPushDispatcher } from './fcm-push-dispatcher.service';
import { DispatchNotificationInput } from './notification-dispatcher';

/**
 * حمولة APNs (docs/08 §124) — التطبيقان على أندرويد كانوا شغالين، وiOS كان بيتسقط بصمت لتلات
 * أسباب مستقلة في نفس الحمولة. الاختبار ده بيقفل التلاتة كـregression:
 *
 * 1. رسالة actionable كانت بتتبعت `content-available` بلا `alert` مع `apns-push-type: 'alert'`
 *    — تركيبة غير صالحة عند APNs (نوع الدفع لازم يطابق المحتوى)، والدفع الصامت ممنوع بأولوية 10.
 * 2. مفيش `category` فالأزرار مكانتش هتبان أصلاً حتى لو الإشعار وصل.
 * 3. `aps.sound` كان بياخد `sound_key` من الإعدادات كاسم ملف — ومفيش أي ملف صوت متبنّي في
 *    التطبيقين، يعني iOS مكانش بيشغّل صوت خالص لأخطر إشعار في المنتج.
 *
 * الاختبار بينادي `buildMessage` مباشرة (private) لأن ده المكان الوحيد اللي الحمولة بتتبني فيه،
 * ومحدش تاني بيقدر يشوفها من غير Firebase حقيقي.
 */
describe('FcmPushDispatcher.buildMessage() — صحة حمولة APNs مقابل أندرويد', () => {
  type PayloadBuilder = { buildMessage(input: DispatchNotificationInput): MulticastMessage };

  function buildDispatcher(): PayloadBuilder {
    // مفيش FIREBASE_SERVICE_ACCOUNT_JSON = isConfigured:false — مالوش أي أثر على بناء الحمولة،
    // وهو بالظبط اللي بنقيسه هنا (مفيش إرسال حقيقي).
    const config = { get: () => undefined } as unknown as ConfigService;
    return new FcmPushDispatcher(config) as unknown as PayloadBuilder;
  }

  const baseInput: DispatchNotificationInput = {
    userId: 'user-1',
    channel: NotificationChannel.PUSH,
    titleAr: 'عرض شغل جديد',
    bodyAr: 'سباكة — مدينة نصر',
    deepLink: '/orders/abc',
    targets: ['token-1'],
    notificationType: 'order_offer_emergency',
    priorityTier: NotificationPriorityTier.CRITICAL_OFFER,
    soundKey: 'critical_offer_alert',
    isActionable: true,
    actionLabels: { accept: 'قبول', reject: 'رفض' },
  };

  it('actionable: iOS بياخد alert حقيقي (مش دفع صامت) عشان التسليم يبقى مضمون', () => {
    const message = buildDispatcher().buildMessage(baseInput);
    const aps = message.apns?.payload?.aps as Record<string, unknown>;

    expect(aps.alert).toEqual({ title: 'عرض شغل جديد', body: 'سباكة — مدينة نصر' });
    // البَقّة الأصلية: content-available بلا alert = APNs بيأخّر/يسقط الرسالة.
    expect(aps['content-available']).toBeUndefined();
    expect(message.apns?.headers?.['apns-push-type']).toBe('alert');
    // أولوية 10 صالحة **بس** مع تنبيه حقيقي — كانت مع دفع صامت وده مرفوض من APNs.
    expect(message.apns?.headers?.['apns-priority']).toBe('10');
  });

  it('actionable: فئة الأزرار مبعوتة ومطابقة للمسجّلة في تطبيق الفني', () => {
    const message = buildDispatcher().buildMessage(baseInput);
    const aps = message.apns?.payload?.aps as Record<string, unknown>;
    // نفس القيمة بالحرف في technician-app/lib/core/push_notification_service.dart
    // (`_orderOfferCategoryId`) — أي انحراف بينهم = إشعار بلا أزرار على iOS.
    expect(aps.category).toBe('ORDER_OFFER_ACTIONS');
  });

  it('actionable: أندرويد لسه data-only بالحرف — مفيش تغيير في مساره', () => {
    const message = buildDispatcher().buildMessage(baseInput);

    expect(message.notification).toBeUndefined();
    expect(message.data).toMatchObject({
      actionable: 'true',
      title: 'عرض شغل جديد',
      body: 'سباكة — مدينة نصر',
      action_labels: JSON.stringify({ accept: 'قبول', reject: 'رفض' }),
    });
    expect(message.android?.priority).toBe('high');
  });

  it('الصوت المبعوت لـAPNs دايمًا default مهما كان sound_key (مفيش ملفات صوت متبنّية)', () => {
    const actionable = buildDispatcher().buildMessage(baseInput);
    const plain = buildDispatcher().buildMessage({ ...baseInput, isActionable: false });

    expect((actionable.apns?.payload?.aps as Record<string, unknown>).sound).toBe('default');
    expect((plain.apns?.payload?.aps as Record<string, unknown>).sound).toBe('default');
    // المعلومة نفسها مش ضايعة — لسه في data عشان الـmapping لما تتبنّى ملفات حقيقية.
    expect(actionable.data?.sound_key).toBe('critical_offer_alert');
  });

  it('غير actionable: notification block عادي للمنصتين (مفيش انحدار)', () => {
    const message = buildDispatcher().buildMessage({
      ...baseInput,
      isActionable: false,
      priorityTier: NotificationPriorityTier.INFORMATIONAL,
    });

    expect(message.notification).toEqual({ title: 'عرض شغل جديد', body: 'سباكة — مدينة نصر' });
    expect(message.apns?.headers?.['apns-priority']).toBe('5');
    expect(message.data?.actionable).toBe('false');
  });
});
