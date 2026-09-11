import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { PaymentChannelsController } from './payment-channels.controller';
import { PaymentMethodAvailabilityGuard } from './payment-method-availability.guard';
import { PaymentProviderRegistry } from './gateways/payment-provider.registry';
import { PaymentMethod } from './entities/payment.entity';
import { PaymobProvider } from './gateways/paymob-provider.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';

const CUSTOMER: JwtPayload = { sub: 'customer-1', userType: UserType.CUSTOMER, amr: ['otp'] };
const ADMIN: JwtPayload = { sub: 'admin-1', userType: UserType.ADMIN, amr: ['otp'] };

// اختبار حي ضد Postgres/Redis حقيقيين — بَقّة حقيقية اتلقطت من صاحب المشروع (2026-08-21): الكاش
// كان الوسيلة الوحيدة اللي `isConfigured` بتاعتها ثابتة `true` دايمًا (بلا بوابة خارجية تتفحص)،
// فمكانش فيه أي طريقة الأدمن يعطّلها من الإعدادات زي باقي الوسائل (`payments.fawry_enabled`).
describe('PaymentChannelsController — إعداد payments.cash_enabled (docs/08، بَقّة كاش على طلب بلا فني)', () => {
  let dataSource: DataSource;
  let settingsService: SettingsService;
  let cache: RedisCacheService;
  let controller: PaymentChannelsController;

  const fakeRegistry = {
    listAll: () => [
      // الترتيب هنا **عمدًا** مش ترتيب العرض المطلوب — الاختبار بيثبت إن الـcontroller
      // هو اللي بيرتّب، مش إنه بيرجّع ترتيب السجل بالصدفة.
      { method: PaymentMethod.CASH, isConfigured: true },
      { method: PaymentMethod.CARD, isConfigured: false },
      { method: PaymentMethod.WALLET, isConfigured: true },
      { method: PaymentMethod.INSTAPAY, isConfigured: true },
    ],
  } as unknown as PaymentProviderRegistry;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting],
    });
    await dataSource.initialize();
    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    settingsService = new SettingsService(dataSource.getRepository(Setting), { record: async () => undefined } as unknown as AuditLogService, cache);
    controller = new PaymentChannelsController(
      fakeRegistry,
      settingsService,
      { getConfigurationStatus: () => ({ configured: false, missingFields: ['API Key'] }) } as PaymobProvider,
      // الحارس الحقيقي مش mock: هو مصدر الحقيقة الوحيد لخريطة «المفتاح ← وسيلة الدفع» بعد ج-١٨،
      // فاستبداله بـmock كان هيخلّي الاختبار يقيس نسخة تانية من المنطق بدل اللي شغّالة فعلاً.
      new PaymentMethodAvailabilityGuard(settingsService),
    );
  });

  afterAll(async () => {
    // نرجّع الإعداد الحقيقي المشترك لقيمته الافتراضية دايمًا (SQL خام + إبطال كاش — مش
    // settingsService.update()، عشان معندناش user حقيقي هنا لـupdated_by_user_id)، حتى لو
    // اختبار في النص فشل قبل ما finally بتاعه يشتغل.
    await dataSource.query(`UPDATE settings SET value = 'true', updated_by_user_id = NULL WHERE key = 'payments.cash_enabled'`);
    await cache.del('settings:payments.cash_enabled');
    settingsService.invalidateLocalCache('payments.cash_enabled');
    cache.onModuleDestroy();
    await dataSource.destroy();
  });

  it('payments.cash_enabled=true (الافتراضي) — الكاش متاح زي isConfigured بتاعته بالظبط', async () => {
    const items = await controller.list(CUSTOMER);
    expect(items.find((i) => i.method === PaymentMethod.CASH)?.is_available).toBe(true);
    expect(items.find((i) => i.method === PaymentMethod.CARD)?.is_available).toBe(false);
    expect(items.find((i) => i.method === PaymentMethod.WALLET)?.is_available).toBe(true);
  });

  // docs/08 §76-ز — بلاغ مالك: نصوص موجّهة للأدمن كانت بتظهر للعميل. الأخطر إن سبب الكارت
  // كان بيطبع أسماء متغيّرات إعداد Paymob الناقصة حرفيًا في شاشة العميل.
  it('العميل ما يشوفش أي تشخيص تشغيلي ولا أسماء إعدادات', async () => {
    const items = await controller.list(CUSTOMER);
    for (const item of items) {
      expect(item.admin_note).toBeUndefined();
      if (item.unavailable_reason) {
        expect(item.unavailable_reason).not.toMatch(/أدمن|Paymob|API Key|إعداد/);
      }
    }
    expect(items.find((i) => i.method === PaymentMethod.CARD)?.unavailable_reason)
      .toBe('الطريقة دي مش متاحة دلوقتي — اختار طريقة تانية');
  });

  it('الأدمن لسه بياخد التشخيص الكامل — التشخيص ما اتشالش، اتنقل لمكانه الصح', async () => {
    const items = await controller.list(ADMIN);
    expect(items.find((i) => i.method === PaymentMethod.CARD)?.admin_note).toContain('API Key');
    expect(items.find((i) => i.method === PaymentMethod.CASH)?.admin_note).toBeUndefined();
  });

  it('payments.cash_enabled=false — الكاش بس بيتحجب، باقي الوسائل زي isConfigured بتاعتها من غير تغيير', async () => {
    await dataSource.query(
      `UPDATE settings SET value = 'false' WHERE key = 'payments.cash_enabled'`,
    );
    await cache.del('settings:payments.cash_enabled');
    // كتابة SQL مباشرة بتتخطى `SettingsService.update()`، والخدمة بتخدم القيمة المحلية ولو
    // عمرها خلص (stale-while-revalidate) — فمسح Redis وحده مابيبانش. ده المسار المدعوم لأي
    // كاتب من برّه الخدمة، ومن غيره الاختبار كان بيقيس قيمة قديمة ويفشل وهو سليم.
    settingsService.invalidateLocalCache('payments.cash_enabled');
    try {
      const items = await controller.list(CUSTOMER);
      expect(items.find((i) => i.method === PaymentMethod.CASH)?.is_available).toBe(false);
      expect(items.find((i) => i.method === PaymentMethod.WALLET)?.is_available).toBe(true);
    } finally {
      await dataSource.query(`UPDATE settings SET value = 'true' WHERE key = 'payments.cash_enabled'`);
      await cache.del('settings:payments.cash_enabled');
      settingsService.invalidateLocalCache('payments.cash_enabled');
    }
  });

  // طلب مالك 2026-09-11: «InstaPay تبقى أول واحدة فوق وتحتها الكاش وبعد كده الباقي، ومكتوب
  // جنبها إنها المرشّحة».
  describe('ترتيب العرض ووسم الترشيح', () => {
    it('InstaPay أول واحدة، الكاش تحتها، والباقي بعدهم', async () => {
      const items = await controller.list(CUSTOMER);
      expect(items.map((item) => item.method).slice(0, 2)).toEqual([
        PaymentMethod.INSTAPAY,
        PaymentMethod.CASH,
      ]);
      // التقسيط بيتضاف بعد حلقة السجل، فلازم يفضل داخل الترتيب مش ملزوق في الآخر بالصدفة.
      expect(items.map((item) => item.method)).toContain('installment');
    });

    it('الوسم على الوسيلة المرشّحة بس، وبنصّه الجاهز', async () => {
      const items = await controller.list(CUSTOMER);
      const recommended = items.filter((item) => item.is_recommended);
      expect(recommended.map((item) => item.method)).toEqual([PaymentMethod.INSTAPAY]);
      expect(recommended[0].recommended_label_ar).toBeTruthy();
      // أي وسيلة تانية لازم ترجع `null` مش نص فاضي — الواجهة بتفرّق بينهم.
      expect(items.find((item) => item.method === PaymentMethod.CASH)?.recommended_label_ar).toBeNull();
    });

    it('وسيلة مش متاحة مابتترشّحش حتى لو الإعداد مسمّيها', async () => {
      await dataSource.query(`UPDATE settings SET value = 'false' WHERE key = 'payments.instapay_enabled'`);
      await cache.del('settings:payments.instapay_enabled');
      settingsService.invalidateLocalCache('payments.instapay_enabled');
      try {
        const items = await controller.list(CUSTOMER);
        const instapay = items.find((item) => item.method === PaymentMethod.INSTAPAY);
        expect(instapay?.is_available).toBe(false);
        // ترشيح وسيلة العميل مش قادر يستخدمها بيضايقه مش بيساعده.
        expect(instapay?.is_recommended).toBe(false);
        expect(items.some((item) => item.is_recommended)).toBe(false);
      } finally {
        await dataSource.query(`UPDATE settings SET value = 'true' WHERE key = 'payments.instapay_enabled'`);
        await cache.del('settings:payments.instapay_enabled');
        settingsService.invalidateLocalCache('payments.instapay_enabled');
      }
    });
  });
});
