import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { Setting } from './entities/setting.entity';
import { SettingsService } from './settings.service';
import { SocialLinksController } from './social-links.controller';

/**
 * docs/08 §136 — روابط السوشيال. الاختبار حي على Postgres حقيقي عشان يغطّي قراءة الإعدادات
 * الفعلية (مع الكاش)، مش دالة مساعدة معزولة.
 *
 * الالتزامان اللي بيثبّتهم:
 *   ١. **الفاضي بيختفي** — الأيقونة اللي مالهاش رابط ما تتعرضش أصلاً، مش تتعرض وتودّي لحتة فاضية.
 *   ٢. **`https://` بس** — القيمة دي بتتحوّل لـ`href` بيتنفّذ على متصفح المستخدم، فأي
 *      `javascript:`/`http:`/`data:` لازم يترفض من مسار القراءة نفسه.
 */
describe('SocialLinksController (docs/08 §136)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let controller: SocialLinksController;
  let settingsService: SettingsService;

  const KEYS = [
    'social.facebook_url',
    'social.instagram_url',
    'social.tiktok_url',
    'social.linkedin_url',
    'social.youtube_url',
  ];
  const originals = new Map<string, string>();

  async function setSetting(key: string, value: string) {
    await dataSource.query(
      `INSERT INTO settings (key, value, value_type, group_name) VALUES ($1,$2,'string','social')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
    await cache.del(`settings:${key}`);
    // نفس سبب `legal-entity.controller.spec.ts`: الخدمة بتخدم القيمة المحلية ولو عمرها خلص
    // (stale-while-revalidate)، والإبطال الصريح هو المسار المدعوم لأي كاتب من برّه الخدمة.
    settingsService.invalidateLocalCache(key);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting],
    });
    await dataSource.initialize();
    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    settingsService = new SettingsService(
      dataSource.getRepository(Setting),
      {} as unknown as AuditLogService,
      cache,
    );
    controller = new SocialLinksController(settingsService);

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
        settingsService.invalidateLocalCache(key);
      }
    } finally {
      await dataSource.destroy();
      cache.onModuleDestroy();
    }
  }, 20000);

  it('كل المفاتيح الخمسة موجودة في القاعدة — الأدمن يقدر يملاها فعلاً', async () => {
    const rows = await dataSource.query<Array<{ key: string }>>(
      `SELECT key FROM settings WHERE key = ANY($1)`,
      [KEYS],
    );
    expect(rows.map((r) => r.key).sort()).toEqual([...KEYS].sort());
  }, 20000);

  it('لما تكون كلها فاضية بيرجع قايمة فاضية — مفيش أيقونة بتودّي لحتة فاضية', async () => {
    for (const key of KEYS) await setSetting(key, '');
    expect((await controller.get()).links).toEqual([]);
  }, 20000);

  it('بيرجّع المضبوط بس، بترتيب العرض الثابت', async () => {
    for (const key of KEYS) await setSetting(key, '');
    await setSetting('social.instagram_url', 'https://instagram.com/osta');
    await setSetting('social.linkedin_url', 'https://linkedin.com/company/osta');

    const { links } = await controller.get();
    expect(links).toEqual([
      { network: 'instagram', url: 'https://instagram.com/osta' },
      { network: 'linkedin', url: 'https://linkedin.com/company/osta' },
    ]);
  }, 20000);

  it('أي حاجة مش https:// بترفض — مش رابط في مستند بيتعرض على كل صفحة', async () => {
    for (const key of KEYS) await setSetting(key, '');
    await setSetting('social.facebook_url', 'javascript:alert(1)');
    await setSetting('social.tiktok_url', 'http://tiktok.com/@osta');
    await setSetting('social.youtube_url', 'osta');

    expect((await controller.get()).links).toEqual([]);
  }, 20000);

  it('المسافات الزايدة بتتشال قبل الفحص — مسافة واحدة مكانتش تخلّي الرابط يتحجب', async () => {
    for (const key of KEYS) await setSetting(key, '');
    await setSetting('social.facebook_url', '  https://facebook.com/osta  ');
    expect((await controller.get()).links).toEqual([{ network: 'facebook', url: 'https://facebook.com/osta' }]);
  }, 20000);
});
