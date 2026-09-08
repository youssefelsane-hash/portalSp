import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import {
  SETTING_RELOAD_REQUIRED_EVENT,
  SETTING_UPDATED_EVENT,
  SettingUpdatedEvent,
} from './setting-updated.event';
import { SettingsCrossInstanceBridge } from './settings-cross-instance.bridge';

/**
 * **بَقّة حقيقية كانت قايمة**: الأدمن يغيّر مفاتيح بوابة الدفع ⇒ النسخة اللي عليها الطلب بس
 * هي اللي بتعيد التحميل. أي نسخة تانية بتفضل تحصّل **بالمفاتيح القديمة** لحد ما تترستِرت.
 *
 * الاختبار ده بيشغّل **جسرين حقيقيين** على نفس القاعدة — ده بالظبط شكل نسختين من الـAPI —
 * وبيتأكد إن الإشارة بتعدّي فعلاً، وإنها **مابتترجّعش على النسخة الباعثة** (تكرار بلا فايدة)،
 * وإن مفيش حلقة لا نهائية.
 *
 * ليه على قاعدة حيّة مش mock: القناة نفسها هي اللي بتتختبر — `LISTEN/NOTIFY` بيتنفّذوا في
 * Postgres، فmock هيختبر الكود اللي أنا كاتبه ضد نفسه.
 */
describe('جسر الإعدادات بين النسخ — الإشارة بتعدّي فعلاً (تدقيق A-3)', () => {
  jest.setTimeout(30_000);

  let dataSourceA: DataSource;
  let dataSourceB: DataSource;
  let bridgeA: SettingsCrossInstanceBridge;
  let bridgeB: SettingsCrossInstanceBridge;
  let eventsA: EventEmitter2;
  let eventsB: EventEmitter2;

  const url = process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak';

  /** بينتظر لحد ما الشرط يتحقق أو المهلة تخلص — NOTIFY غير متزامن بطبعه. */
  async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return predicate();
  }

  beforeAll(async () => {
    dataSourceA = new DataSource({ type: 'postgres', url, entities: [] });
    dataSourceB = new DataSource({ type: 'postgres', url, entities: [] });
    await dataSourceA.initialize();
    await dataSourceB.initialize();

    eventsA = new EventEmitter2();
    eventsB = new EventEmitter2();
    bridgeA = new SettingsCrossInstanceBridge(dataSourceA, eventsA);
    bridgeB = new SettingsCrossInstanceBridge(dataSourceB, eventsB);
    await bridgeA.onModuleInit();
    await bridgeB.onModuleInit();
  });

  afterAll(async () => {
    await bridgeA?.onModuleDestroy();
    await bridgeB?.onModuleDestroy();
    if (dataSourceA?.isInitialized) await dataSourceA.destroy();
    if (dataSourceB?.isInitialized) await dataSourceB.destroy();
  });

  it('تغيير على النسخة A بيوصل النسخة B كـ«أعِد التحميل»', async () => {
    const received: string[] = [];
    eventsB.on(SETTING_RELOAD_REQUIRED_EVENT, (event: SettingUpdatedEvent) => received.push(event.key));

    await bridgeA.broadcast(new SettingUpdatedEvent('payments.paymob_api_key', 'secret-value'));

    expect(await waitFor(() => received.includes('payments.paymob_api_key'))).toBe(true);
  });

  it('النسخة الباعثة مابتعيدش تحميل نفسها — المستمعين المحليين اشتغلوا من الحدث الأصلي', async () => {
    const selfReceived: string[] = [];
    eventsA.on(SETTING_RELOAD_REQUIRED_EVENT, (event: SettingUpdatedEvent) => selfReceived.push(event.key));

    await bridgeA.broadcast(new SettingUpdatedEvent('payments.instapay_ipa_address', 'x@bank'));

    // مهلة كافية إن الإشعار كان هيوصل لو كان هيترجّع.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(selfReceived).toEqual([]);
  });

  it('القيمة نفسها مابتعديش في القناة — الأسرار مابتتنقلش، المستمع بيقرا من مصدره', async () => {
    const values: unknown[] = [];
    eventsB.on(SETTING_RELOAD_REQUIRED_EVENT, (event: SettingUpdatedEvent) => values.push(event.value));

    await bridgeA.broadcast(new SettingUpdatedEvent('payments.paymob_hmac_secret', 'TOP-SECRET'));

    expect(await waitFor(() => values.length > 0)).toBe(true);
    expect(values).not.toContain('TOP-SECRET');
    expect(values[values.length - 1]).toBeUndefined();
  });

  it('مفيش حلقة: الحدث العابر مابيولّدش إشعارًا جديدًا', async () => {
    const onB: string[] = [];
    eventsB.on(SETTING_RELOAD_REQUIRED_EVENT, (event: SettingUpdatedEvent) => onB.push(event.key));
    const onA: string[] = [];
    eventsA.on(SETTING_RELOAD_REQUIRED_EVENT, (event: SettingUpdatedEvent) => onA.push(event.key));

    await bridgeA.broadcast(new SettingUpdatedEvent('matching.batch_size', 12));

    expect(await waitFor(() => onB.includes('matching.batch_size'))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // لو الجسر كان بيعيد إطلاق SETTING_UPDATED_EVENT، B كانت هتنادي broadcast وتولّد إشعار
    // يرجع لـA، وA ترجّعه… العدد هنا بيثبت إن الدورة مقفولة.
    expect(onB.filter((k) => k === 'matching.batch_size')).toHaveLength(1);
    expect(onA.filter((k) => k === 'matching.batch_size')).toHaveLength(0);
  });

  it('فشل الإشعار مابيكسرش حفظ الإعداد — بيتسجّل تحذير ويكمّل', async () => {
    const brokenDataSource = { query: jest.fn().mockRejectedValue(new Error('القاعدة واقعة')) } as unknown as DataSource;
    const bridge = new SettingsCrossInstanceBridge(brokenDataSource, new EventEmitter2());

    await expect(bridge.broadcast(new SettingUpdatedEvent('otp.max_attempts', 5))).resolves.toBeUndefined();
  });

  it('الجسر مشترك فعلاً في الحدث المحلي — مش محتاج نداء يدوي', () => {
    // الديكوريتور بيتسجّل كـmetadata على الدالة؛ الفحص ده بيمنع حذفه سهوًا في إعادة هيكلة.
    const metadata = Reflect.getMetadata('EVENT_LISTENER_METADATA', SettingsCrossInstanceBridge.prototype.broadcast) as
      | { event: string }[]
      | undefined;
    expect(metadata?.some((entry) => entry.event === SETTING_UPDATED_EVENT)).toBe(true);
  });
});
