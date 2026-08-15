import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { Setting } from './entities/setting.entity';
import { SettingsService } from './settings.service';
import { SupportContactController } from './support-contact.controller';

// اختبار حي ضد Postgres/Redis حقيقيين — بيانات تواصل خدمة العملاء (docs/08 §22 بند 15-19). أهم
// جزء هنا التحقق الأمني: قيمة whatsapp_number/help_url غير آمنة (مش أرقام بس / مش https://) لازم
// ترجع null بدل ما تتبني في deep link ممكن يتنفّذ على جهاز المستخدم (§19 من طلب المالك).
describe('SupportContactController.getSupportContact() — تحقق أمان deep link (docs/08 §22 بند 19)', () => {
  let dataSource: DataSource;
  let controller: SupportContactController;
  let settingsService: SettingsService;
  let testAdminId: string;
  const runId = Date.now().toString(36);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting, User],
    });
    await dataSource.initialize();

    const [admin] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2028${runId}`.slice(0, 15), `أدمن اختبار خدمة عملاء ${runId}`],
    );
    testAdminId = admin.id;

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const auditLogStub = { record: async () => undefined } as unknown as AuditLogService;
    settingsService = new SettingsService(dataSource.getRepository(Setting), auditLogStub, cache);
    controller = new SupportContactController(settingsService);
  });

  afterAll(async () => {
    // إرجاع القيم المزروعة من migration 0106 لحالتها الافتراضية — الاختبار ده بيعدّل صفوف حقيقية
    // مشتركة (مفتاح واحد بس لكل النظام)، لازم يرجّعها زي ما كانت عشان مايأثرش على تشغيلات تانية.
    await dataSource.query(
      `UPDATE settings SET value = '""'::jsonb, updated_by_user_id = NULL WHERE key IN ('support.whatsapp_number', 'support.help_url', 'support.phone_number', 'support.email')`,
    );
    await dataSource.query(`UPDATE settings SET value = 'false'::jsonb, updated_by_user_id = NULL WHERE key = 'support.enabled'`);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [testAdminId]);
    await dataSource.destroy();
  });

  it('رقم واتساب فيه رموز/فراغات — يترفض (null)، مش يتبني في رابط', async () => {
    await settingsService.update(testAdminId, 'support.whatsapp_number', '+20 100 123 4567 <script>');
    await settingsService.update(testAdminId, 'support.enabled', true);

    const result = await controller.getSupportContact();
    expect(result.whatsapp_number).toBeNull();
    expect(result.whatsapp_url).toBeNull();
  });

  it('رقم واتساب صحيح (أرقام بس) — يتقبل ويتبني رابط wa.me صح', async () => {
    await settingsService.update(testAdminId, 'support.whatsapp_number', '201001234567');

    const result = await controller.getSupportContact();
    expect(result.whatsapp_number).toBe('201001234567');
    expect(result.whatsapp_url).toBe('https://wa.me/201001234567');
  });

  it('help_url بـscheme غير آمن (javascript:) — يترفض (null)', async () => {
    await settingsService.update(testAdminId, 'support.help_url', 'javascript:alert(1)');

    const result = await controller.getSupportContact();
    expect(result.help_url).toBeNull();
  });

  it('help_url صحيح (https://) — يتقبل زي ما هو', async () => {
    await settingsService.update(testAdminId, 'support.help_url', 'https://baytak.app/help');

    const result = await controller.getSupportContact();
    expect(result.help_url).toBe('https://baytak.app/help');
  });

  it('support.enabled=false — التطبيقات تقدر تخفي القسم كله بناءً عليه', async () => {
    await settingsService.update(testAdminId, 'support.enabled', false);

    const result = await controller.getSupportContact();
    expect(result.enabled).toBe(false);
  });
});
