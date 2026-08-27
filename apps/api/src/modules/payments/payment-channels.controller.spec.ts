import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { PaymentChannelsController } from './payment-channels.controller';
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
      { method: PaymentMethod.CASH, isConfigured: true },
      { method: PaymentMethod.CARD, isConfigured: false },
      { method: PaymentMethod.WALLET, isConfigured: true },
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
    );
  });

  afterAll(async () => {
    // نرجّع الإعداد الحقيقي المشترك لقيمته الافتراضية دايمًا (SQL خام + إبطال كاش — مش
    // settingsService.update()، عشان معندناش user حقيقي هنا لـupdated_by_user_id)، حتى لو
    // اختبار في النص فشل قبل ما finally بتاعه يشتغل.
    await dataSource.query(`UPDATE settings SET value = 'true', updated_by_user_id = NULL WHERE key = 'payments.cash_enabled'`);
    await cache.del('settings:payments.cash_enabled');
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
    try {
      const items = await controller.list(CUSTOMER);
      expect(items.find((i) => i.method === PaymentMethod.CASH)?.is_available).toBe(false);
      expect(items.find((i) => i.method === PaymentMethod.WALLET)?.is_available).toBe(true);
    } finally {
      await dataSource.query(`UPDATE settings SET value = 'true' WHERE key = 'payments.cash_enabled'`);
      await cache.del('settings:payments.cash_enabled');
    }
  });
});
