import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { Setting } from './entities/setting.entity';
import { SettingsService } from './settings.service';
import { LegalEntityController } from './legal-entity.controller';

/**
 * docs/08 §100 — بيانات الجهة المشغّلة. الاختبار حي على Postgres حقيقي عشان يغطّي **قراءة
 * الإعدادات الفعلية** (مع الكاش) مش الدوال المساعدة بس.
 *
 * أهم التزام هنا: **القيمة الفاضية بترجع `null` مش سلسلة فاضية** — المالك طلب صراحةً «لو أي
 * بيانات لسه فاضية، ما تظهرش كسطر فاضي في الصفحة»، والواجهة بتعتمد على `null` عشان تخفي السطر.
 */
describe('LegalEntityController (docs/08 §100)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let controller: LegalEntityController;

  const KEYS = [
    'legal.platform_name_ar',
    'legal.platform_name_en',
    'legal.company_name_ar',
    'legal.company_name_en',
    'legal.legal_address',
    'legal.support_email',
    'legal.privacy_email',
    'legal.support_phone',
    'legal.website_url',
    'legal.commercial_register',
    'legal.tax_id',
  ];
  const originals = new Map<string, string>();

  async function setSetting(key: string, value: string) {
    await dataSource.query(
      `INSERT INTO settings (key, value, value_type, group_name) VALUES ($1,$2,'string','legal_entity')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
    await cache.del(`settings:${key}`);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting],
    });
    await dataSource.initialize();
    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(
      dataSource.getRepository(Setting),
      {} as unknown as AuditLogService,
      cache,
    );
    controller = new LegalEntityController(settingsService);

    const rows = await dataSource.query<Array<{ key: string; value: string }>>(
      `SELECT key, value::text AS value FROM settings WHERE key = ANY($1)`,
      [KEYS],
    );
    for (const row of rows) originals.set(row.key, row.value);
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      for (const [key, value] of originals) {
        await dataSource.query(`UPDATE settings SET value = $2::jsonb WHERE key = $1`, [key, value]);
        await cache.del(`settings:${key}`);
      }
    } finally {
      await dataSource.destroy();
      cache.onModuleDestroy();
    }
  }, 20000);

  it('الأسماء المعتمدة بترجع زي ما المالك حددها بالظبط', async () => {
    const result = await controller.get();
    expect(result.platform_name_ar).toBe('أسطى');
    expect(result.platform_name_en).toBe('OSTA');
    expect(result.company_name_ar).toBe('الصانع جروب');
    expect(result.company_name_en).toBe('ELSANE Group');
  }, 20000);

  it('البيانات اللي لسه فاضية بترجع null — مش سلسلة فاضية تطلع سطر أعرج في مستند قانوني', async () => {
    for (const key of ['legal.legal_address', 'legal.support_email', 'legal.support_phone', 'legal.website_url']) {
      await setSetting(key, '');
    }
    const result = await controller.get();
    expect(result.legal_address).toBeNull();
    expect(result.support_email).toBeNull();
    expect(result.support_phone).toBeNull();
    expect(result.website_url).toBeNull();
  }, 20000);

  it('القيم المملوّة بترجع منظّفة من المسافات', async () => {
    await setSetting('legal.support_email', '  support@osta.example  ');
    await setSetting('legal.support_phone', ' +20 100 000 0000 ');
    await setSetting('legal.legal_address', '  القاهرة، مصر  ');
    const result = await controller.get();
    expect(result.support_email).toBe('support@osta.example');
    expect(result.support_phone).toBe('+20 100 000 0000');
    expect(result.legal_address).toBe('القاهرة، مصر');
  }, 20000);

  it('بريد الخصوصية بيرجع لبريد الدعم لو مش متحدد — صاحب البيانات لازم يلاقي قناة', async () => {
    await setSetting('legal.support_email', 'support@osta.example');
    await setSetting('legal.privacy_email', '');
    const result = await controller.get();
    expect(result.privacy_email).toBe('support@osta.example');

    await setSetting('legal.privacy_email', 'privacy@osta.example');
    expect((await controller.get()).privacy_email).toBe('privacy@osta.example');
  }, 20000);

  it('قيم غير صالحة بتترفض بأمان بدل ما تتحط في رابط بيتنفّذ على جهاز المستخدم', async () => {
    await setSetting('legal.support_email', 'مش-إيميل');
    await setSetting('legal.privacy_email', '');
    await setSetting('legal.support_phone', 'اتصل بينا');
    await setSetting('legal.website_url', 'javascript:alert(1)');
    const result = await controller.get();
    expect(result.support_email).toBeNull();
    expect(result.privacy_email).toBeNull();
    expect(result.support_phone).toBeNull();
    expect(result.website_url).toBeNull();

    // http:// عادي برضه مرفوض — https بس.
    await setSetting('legal.website_url', 'http://osta.example');
    expect((await controller.get()).website_url).toBeNull();
    await setSetting('legal.website_url', 'https://osta.example');
    expect((await controller.get()).website_url).toBe('https://osta.example');
  }, 20000);
});
