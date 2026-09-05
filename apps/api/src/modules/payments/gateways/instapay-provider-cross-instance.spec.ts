import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../../common/cache/redis-cache.service';
import { SettingsCrossInstanceBridge } from '../../../common/events/settings-cross-instance.bridge';
import { SettingUpdatedEvent } from '../../../common/events/setting-updated.event';
import { AuditLogService } from '../../audit/audit-log.service';
import { Setting } from '../../settings/entities/setting.entity';
import { SettingsService } from '../../settings/settings.service';
import { STORAGE_SERVICE } from '../../../common/storage/storage.service';
import { InstaPayQrService } from './instapay-qr.service';
import { InstaPayProvider } from './instapay-provider.service';

const IPA_KEY = 'payments.instapay.ipa_address';
const RECIPIENT_KEY = 'payments.instapay.recipient_name';

/**
 * **الادعاء اللي بيتختبر هنا هو اللي المالك بيهمّه فعلاً**، مش الأنبوبة:
 * الأدمن غيّر عنوان InstaPay على **نسخة**، و**نسخة تانية** بقت تعرف العنوان الجديد
 * من غير restart.
 *
 * قبل الإصلاح ده كانت النسخة التانية تفضل ماسكة العنوان القديم في الذاكرة إلى ما لا نهاية،
 * فنص عملاء التحويل كانوا هياخدوا حساب قديم/ملغي — **بلا أي خطأ في اللوج**.
 *
 * النسخة B هنا مبنية بـ`Test.createTestingModule` مع `EventEmitterModule` حقيقي، عشان تسجيل
 * `@OnEvent` يكون هو الحقيقي — نداء الدالة يدويًا كان هيختبر الدالة ويسيب الديكوريتور
 * (اللي هو محل الإصلاح) بلا تغطية.
 */
describe('بوابة InstaPay — نسخة تانية بتعرف الإعداد الجديد بلا restart (تدقيق A-3)', () => {
  jest.setTimeout(30_000);

  const url = process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak';
  let dataSourceA: DataSource;
  let dataSourceB: DataSource;
  let moduleB: TestingModule;
  let providerB: InstaPayProvider;
  let bridgeA: SettingsCrossInstanceBridge;
  let bridgeB: SettingsCrossInstanceBridge;
  let cacheB: RedisCacheService;
  const original = new Map<string, string>();

  async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return predicate();
  }

  beforeAll(async () => {
    dataSourceA = new DataSource({ type: 'postgres', url, entities: [Setting] });
    dataSourceB = new DataSource({ type: 'postgres', url, entities: [Setting] });
    await dataSourceA.initialize();
    await dataSourceB.initialize();

    for (const key of [IPA_KEY, RECIPIENT_KEY]) {
      const [row] = await dataSourceA.query(`SELECT value FROM settings WHERE key = $1`, [key]);
      original.set(key, typeof row?.value === 'string' ? row.value : '');
    }

    cacheB = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);

    // ── النسخة B: تطبيق حقيقي بـEventEmitter حقيقي ─────────────────────────────
    moduleB = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        InstaPayProvider,
        InstaPayQrService,
        SettingsService,
        SettingsCrossInstanceBridge,
        { provide: getRepositoryToken(Setting), useValue: dataSourceB.getRepository(Setting) },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: RedisCacheService, useValue: cacheB },
        { provide: STORAGE_SERVICE, useValue: { getSignedUrl: jest.fn() } },
        { provide: DataSource, useValue: dataSourceB },
        { provide: 'DataSourceToken', useValue: dataSourceB },
      ],
    }).compile();
    await moduleB.init();

    providerB = moduleB.get(InstaPayProvider);
    bridgeB = moduleB.get(SettingsCrossInstanceBridge);

    // ── النسخة A: الجسر بس (اللي الأدمن بيحفظ عليها) ────────────────────────────
    bridgeA = new SettingsCrossInstanceBridge(dataSourceA, new EventEmitter2());
    await bridgeA.onModuleInit();
  });

  afterAll(async () => {
    try {
      for (const [key, value] of original) {
        await dataSourceA.query(`UPDATE settings SET value = $1::jsonb WHERE key = $2`, [JSON.stringify(value), key]);
        await cacheB.del(`settings:${key}`).catch(() => undefined);
      }
    } finally {
      await bridgeA?.onModuleDestroy();
      await bridgeB?.onModuleDestroy();
      await moduleB?.close();
      if (dataSourceA?.isInitialized) await dataSourceA.destroy();
      if (dataSourceB?.isInitialized) await dataSourceB.destroy();
      cacheB.onModuleDestroy();
    }
  });

  it('حفظ الإعداد على النسخة A ⇒ النسخة B بتشتغل بيه من غير restart', async () => {
    const newAddress = `audit-a3-${Date.now()}@instapay`;

    // النسخة A بتعمل اللي `SettingsService.update()` بتعمله بالظبط: تكتب، تبطّل الكاش المشترك،
    // وبعدين تبلّغ باقي النسخ.
    await dataSourceA.query(`UPDATE settings SET value = $1::jsonb WHERE key = $2`, [JSON.stringify(newAddress), IPA_KEY]);
    await dataSourceA.query(`UPDATE settings SET value = $1::jsonb WHERE key = $2`, [JSON.stringify('صُنّاع'), RECIPIENT_KEY]);
    await cacheB.del(`settings:${IPA_KEY}`);
    await cacheB.del(`settings:${RECIPIENT_KEY}`);
    await bridgeA.broadcast(new SettingUpdatedEvent(IPA_KEY, newAddress));

    const arrived = await waitFor(() => providerB.isConfigured && providerB['ipaAddress'] === newAddress);
    expect({
      عنوان_النسخة_B: providerB['ipaAddress'],
      البوابة_شغّالة_على_B: providerB.isConfigured,
    }).toEqual({ عنوان_النسخة_B: newAddress, البوابة_شغّالة_على_B: true });
    expect(arrived).toBe(true);
  });

  it('من غير الجسر النسخة B مكانتش هتعرف — نفس السيناريو بلا إشعار', async () => {
    const staleAddress = providerB['ipaAddress'];
    const unseenAddress = `audit-a3-unseen-${Date.now()}@instapay`;

    await dataSourceA.query(`UPDATE settings SET value = $1::jsonb WHERE key = $2`, [JSON.stringify(unseenAddress), IPA_KEY]);
    await cacheB.del(`settings:${IPA_KEY}`);
    // مفيش broadcast — ده بالظبط سلوك ما قبل الإصلاح.

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(providerB['ipaAddress']).toBe(staleAddress);
  });
});
