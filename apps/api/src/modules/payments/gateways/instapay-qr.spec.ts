import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../../audit/audit-log.service';
import { RedisCacheService } from '../../../common/cache/redis-cache.service';
import { ApiException } from '../../../common/exceptions/api.exception';
import { StorageService } from '../../../common/storage/storage.service';
import { Setting } from '../../settings/entities/setting.entity';
import { SettingsService } from '../../settings/settings.service';
import { INSTAPAY_QR_SETTING_KEY, InstaPayQrService } from './instapay-qr.service';

// اختبار حي ضد Postgres/Redis حقيقيين (docs/08 §78-د) — الإعداد بيتقرا/يتكتب من نفس
// SettingsService اللي لوحة الأدمن بتستخدمها، مش mock. التخزين وحده مموّه (رفع ملف حقيقي
// لقرص/S3 مش موضوع الاختبار ده، وسلوك `getUrl` هو اللي محتاجين نثبته: **بيتنادى وقت كل قراءة**).
describe('InstaPayQrService — QR مُدار من الأدمن (§78-د)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let settingsService: SettingsService;
  let cache: RedisCacheService;
  let service: InstaPayQrService;
  let getUrl: jest.Mock;
  let save: jest.Mock;
  let adminUserId: string;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting],
    });
    await dataSource.initialize();

    const [admin] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2017${runId}`.slice(0, 14), `أدمن اختبار QR ${runId}`],
    );
    adminUserId = admin.id as string;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    settingsService = new SettingsService(
      dataSource.getRepository(Setting),
      { record: jest.fn() } as unknown as AuditLogService,
      cache,
      new EventEmitter2(),
    );

    getUrl = jest.fn(async (key: string) => `https://signed.test/${key}?sig=abc`);
    save = jest.fn(async () => 'saved');
    service = new InstaPayQrService(settingsService, {
      save,
      getUrl,
      delete: jest.fn(),
    } as unknown as StorageService);

    await settingsService.update(adminUserId, INSTAPAY_QR_SETTING_KEY, '');
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await settingsService.update(adminUserId, INSTAPAY_QR_SETTING_KEY, '');
      await dataSource.query(`UPDATE settings SET updated_by_user_id = NULL WHERE updated_by_user_id = $1`, [adminUserId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [adminUserId]);
    } finally {
      cache.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('من غير أي إعداد: مفيش QR — العميل بيشوف التعليمات النصية بس', async () => {
    await settingsService.update(adminUserId, INSTAPAY_QR_SETTING_KEY, '');
    expect(await service.getAdminView()).toEqual({ url: null, source: null });
    expect(await service.getCustomerUrl()).toBeNull();
  });

  it('رابط خارجي: بيترجع زي ما هو ومصدره "link"', async () => {
    await service.setLink(adminUserId, 'https://cdn.example.com/instapay-qr.png');
    expect(await service.getAdminView()).toEqual({
      url: 'https://cdn.example.com/instapay-qr.png',
      source: 'link',
    });
  });

  // فحص أمان مش تجميل: صورة QR بتتحمّل بلا تشفير قابلة للتبديل في الطريق، والنتيجة إن فلوس
  // العميل تروح لحساب المهاجم.
  it('رابط http (بلا تشفير) بيترفض', async () => {
    await expect(service.setLink(adminUserId, 'http://cdn.example.com/qr.png')).rejects.toBeInstanceOf(ApiException);
  });

  it('نص مش رابط بيترفض', async () => {
    await expect(service.setLink(adminUserId, 'اكتب هنا')).rejects.toBeInstanceOf(ApiException);
  });

  // **جوهر التصميم**: ملف مرفوع بيتخزّن كـ`storage://<key>` مش كرابط جاهز، والرابط بيتولّد
  // وقت كل قراءة. لو اتخزّن رابط موقّع، كان هيبطل يشتغل بعد انتهاء صلاحيته وشاشة الدفع تعرض
  // صورة مكسورة — نفس الدرس المكتوب في `StorageService.getUrl`.
  it('ملف مرفوع: الرابط بيتولّد من التخزين في كل قراءة', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAQAAADZc7J/AAAAHUlEQVR42u3OMQEAAAgDoK1/aM3g4QcJqL' +
        'oJAAAAAAAAAADgZQGWWQABmFHiFwAAAABJRU5ErkJggg==',
      'base64',
    );
    const view = await service.upload(adminUserId, {
      buffer: png,
      mimetype: 'image/png',
      originalname: 'qr.png',
      size: png.length,
    });

    expect(save).toHaveBeenCalled();
    expect(view.source).toBe('uploaded');
    expect(view.url).toMatch(/^https:\/\/signed\.test\/payments\/instapay-qr\/.+\?sig=abc$/);

    const callsBefore = getUrl.mock.calls.length;
    await service.getCustomerUrl();
    expect(getUrl.mock.calls.length).toBe(callsBefore + 1);
  });

  it('ملف مش صورة بيترفض (magic bytes)', async () => {
    const notAnImage = Buffer.from('<svg onload=alert(1)>');
    await expect(
      service.upload(adminUserId, {
        buffer: notAnImage,
        mimetype: 'image/png',
        originalname: 'qr.svg',
        size: notAnImage.length,
      }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it('الشيل بيرجّع الحالة لـ«مفيش QR»', async () => {
    await service.setLink(adminUserId, 'https://cdn.example.com/instapay-qr.png');
    expect(await service.remove(adminUserId)).toEqual({ url: null, source: null });
    expect(await service.getCustomerUrl()).toBeNull();
  });

  // القاعدة الحاكمة في CLAUDE.md: فشل بنية تحتية ما يكسرش عملية حقيقية للمستخدم. الـQR راحة
  // إضافية فوق التعليمات النصية، فوقوع التخزين لازم يخلّي الدفع يكمّل بلا صورة.
  it('وقوع التخزين ما يكسرش الدفع — بيرجّع null بدل ما يرمي', async () => {
    await settingsService.update(adminUserId, INSTAPAY_QR_SETTING_KEY, 'storage://payments/instapay-qr/x.png');
    getUrl.mockRejectedValueOnce(new Error('S3 down'));
    expect(await service.getCustomerUrl()).toBeNull();
  });
});
