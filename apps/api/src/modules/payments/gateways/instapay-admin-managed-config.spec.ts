import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../../audit/audit-log.service';
import { RedisCacheService } from '../../../common/cache/redis-cache.service';
import { SETTING_UPDATED_EVENT, SettingUpdatedEvent } from '../../../common/events/setting-updated.event';
import { Setting } from '../../settings/entities/setting.entity';
import { SettingsService } from '../../settings/settings.service';
import { InstaPayProvider } from './instapay-provider.service';
import { InstaPayQrService } from './instapay-qr.service';

// اختبار حي ضد Postgres/Redis حقيقيين — §31 (طلب مالك صريح 2026-08-20): عنوان IPA/اسم المستلم
// بقوا يتعدّلوا من /admin/settings مش env vars، ولازم يبانوا لحظيًا في InstaPayProvider من غير
// أي restart للسيرفر. بيثبت الدورة الكاملة: SettingsService.update() (بالظبط زي ما
// admin-settings.controller.ts بينادي بيها فعليًا) → SETTING_UPDATED_EVENT → InstaPayProvider
// بيحدّث isConfigured/ipaAddress/recipientName لحظيًا، بلا أي كود إضافي بينهم غير الحدث.
describe('InstaPayProvider — إعدادات أدمن ديناميكية بدل env vars (§31)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let settingsService: SettingsService;
  let provider: InstaPayProvider;
  let cache: RedisCacheService;
  let adminUserId: string;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ipaKey = 'payments.instapay.ipa_address';
  const nameKey = 'payments.instapay.recipient_name';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting],
    });
    await dataSource.initialize();

    // settings.updated_by_user_id عليها FK حقيقي لـusers — لازم مستخدم موجود فعلاً، مش randomUUID().
    const [admin] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2016${runId}`.slice(0, 14), `أدمن اختبار ${runId}`],
    );
    adminUserId = admin.id as string;

    const events = new EventEmitter2();
    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    settingsService = new SettingsService(dataSource.getRepository(Setting), { record: jest.fn() } as unknown as AuditLogService, cache, events);

    // نضمن إن القيمتين فاضيين قبل أي حاجة — الـmigration بتحطهم فاضيين افتراضيًا، بس الاختبار ده
    // ممكن يتشغّل على بيئة اتظبطت فيها القيمتين فعليًا (سيشن تانية جربت §8 مثلاً). لازم عبر
    // settingsService.update() نفسها (مش raw SQL) عشان تبطّل كاش Redis كمان — راجع بَقّة حقيقية
    // اتلقطت في 31.4 تحت: raw SQL بيعدّل القاعدة بس، الكاش القديم فاضل صحيح لحد TTL، فـ
    // onModuleInit() كان بيقرا قيمة قديمة من الكاش رغم إن القاعدة اتصفّرت فعليًا.
    await settingsService.update(adminUserId, ipaKey, '');
    await settingsService.update(adminUserId, nameKey, '');

    // خدمة الـQR حقيقية بنفس الـsettingsService (docs/08 §78-د) — التخزين stub لأن الاختبار ده
    // عن الإعدادات الديناميكية مش عن رفع الملفات (ده مغطّى في instapay-qr.spec.ts).
    const qrService = new InstaPayQrService(settingsService, {
      save: jest.fn(),
      getUrl: jest.fn(async (key: string) => `https://cdn.test/${key}`),
      delete: jest.fn(),
    });
    provider = new InstaPayProvider(settingsService, qrService);
    // في التطبيق الحقيقي، NestJS's EventEmitterModule بيربط @OnEvent() تلقائيًا وقت الـbootstrap
    // (DI حقيقي). هنا بننشئ الكلاسات يدويًا بـnew (نفس نمط كل الاختبارات الحية في المشروع ده)،
    // فلازم نربط الحدث يدويًا — نفس الأثر بالظبط، مفيش أي فرق في المنطق المُختبر.
    events.on(SETTING_UPDATED_EVENT, (event: SettingUpdatedEvent) => provider.handleSettingUpdated(event));

    await provider.onModuleInit();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      // عبر settingsService.update() (مش raw SQL) عشان الكاش يتبطّل صح لأي تشغيل تاني للسويت
      // الكامل خلال دقيقة (CACHE_TTL_SECONDS) من نفس التشغيل ده — Redis نفسه بيفضل شغال بين
      // العمليات، بعكس Postgres/الداتا اللي بترجع نضيفة مع كل session جديدة.
      await settingsService.update(adminUserId, ipaKey, '');
      await settingsService.update(adminUserId, nameKey, '');
      // رجّع الإعداد التالت اللي اختبار "تحديث إعداد تاني" فوق لمسه لقيمته الافتراضية الأصلية
      // (migration 0092) — عشان مايأثرش على أي سبيك تاني بيقرا نفس المفتاح ده.
      await settingsService.update(adminUserId, 'payments.instapay_confirmation_window_hours', 24);
      // بمفتاح الأدمن نفسه، مش أسماء إعدادات بعينها — بيغطّي التلاتة مفاتيح دي مرة واحدة.
      await dataSource.query(`UPDATE settings SET updated_by_user_id = NULL WHERE updated_by_user_id = $1`, [adminUserId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [adminUserId]);
    } finally {
      cache.onModuleDestroy(); // بدونها الاتصال بـRedis بيفضل فاتح، Jest ميقفلش العملية
      await dataSource.destroy();
    }
  });

  it('isConfigured=false افتراضيًا (القيمتين فاضيين من الـmigration)', () => {
    expect(provider.isConfigured).toBe(false);
  });

  it('تحديث قيمة واحدة بس (عنوان IPA) لسه isConfigured=false — القيمة التانية لسه فاضية', async () => {
    await settingsService.update(adminUserId, ipaKey, `test-${runId}@instapay`);
    expect(provider.isConfigured).toBe(false);
  });

  it('تحديث القيمة التانية (اسم المستلم) بيخلّي isConfigured=true لحظيًا — بلا أي restart', async () => {
    await settingsService.update(adminUserId, nameKey, `فني اختبار ${runId}`);
    expect(provider.isConfigured).toBe(true);

    const result = await provider.createPayment({
      paymentId: randomUUID(),
      orderNumber: `ORD-${runId}`,
      amountCents: 15000,
      currencyCode: 'EGP',
      customerFirstName: 'أحمد',
      customerLastName: 'تجريبي',
      customerEmail: 'test@example.com',
      customerPhone: '+201000000000',
    });
    if (result.kind !== 'reference') throw new Error('InstaPay لازم يرجّع reference');
    expect(result.instructionsAr).toContain(`test-${runId}@instapay`);
    expect(result.instructionsAr).toContain(`فني اختبار ${runId}`);
  });

  it('مسح قيمة واحدة بعد التفعيل بيرجّع isConfigured=false تاني (دورة كاملة اتأكدت)', async () => {
    await settingsService.update(adminUserId, ipaKey, '');
    expect(provider.isConfigured).toBe(false);
  });

  it('تحديث إعداد تاني غير علاقة بالـinstapay ميأثرش على isConfigured خالص', async () => {
    // نرجّع القيمتين مفعّلتين الأول
    await settingsService.update(adminUserId, ipaKey, `test-${runId}@instapay`);
    await settingsService.update(adminUserId, nameKey, `فني اختبار ${runId}`);
    expect(provider.isConfigured).toBe(true);

    await settingsService.update(adminUserId, 'payments.instapay_confirmation_window_hours', 48);
    expect(provider.isConfigured).toBe(true); // مفيش تأثير — حدث لمفتاح مختلف تمامًا
  });
});
