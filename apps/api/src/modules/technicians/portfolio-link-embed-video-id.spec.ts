import { DataSource } from 'typeorm';
import { PortfolioLinksService } from './portfolio-links.service';
import { PortfolioLinkPlatform, TechnicianPortfolioLink } from './entities/technician-portfolio-link.entity';
import { toPortfolioLinkResponseDto } from './dto/portfolio-link-response.dto';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { SettingsService } from '../settings/settings.service';

// بَقّة حقيقية اتلقطت (docs/08 §81، بلاغ مالك بلينك تيك توك حقيقي فشل يشتغل رغم إن الـthumbnail
// ظهر صح): السبب إن الكلاينت (customer-app) كان بيحاول يفكّ اللينك الخام بـregex محلي بدل ما
// يستخدم الـID الفعلي اللي الباك-إند استخرجه بالفعل وقت oEmbed. الاختبار ده بيتأكد إن الباك-إند
// بقى فعلاً بيحفظ الـID ده (embed_product_id من رد oEmbed تيك توك الرسمي) في embedVideoId.
describe('PortfolioLinksService — embed_video_id (docs/08 §81)', () => {
  let dataSource: DataSource;
  let service: PortfolioLinksService;
  const runId = Date.now().toString(36);
  const ids = { techUser: '', techProfile: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianPortfolioLink, User, TechnicianProfile],
    });
    await dataSource.initialize();

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2091${runId}`.slice(0, 15),
      `فني اختبار معرض ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCPL${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const settingsStub = { getString: async () => '' } as unknown as SettingsService;
    service = new PortfolioLinksService(dataSource.getRepository(TechnicianPortfolioLink), settingsStub);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_portfolio_links WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.techUser]);
    } finally {
      await dataSource.destroy();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('لينك تيك توك — بيحفظ embed_product_id من رد oEmbed في embedVideoId', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        thumbnail_url: 'https://p16.tiktokcdn.com/thumb.jpg',
        title: 'فيديو تصليح مواسير',
        embed_product_id: '7123456789012345678',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // نفس الرابط short-link اللي كان بيفشل يشتغل للعميل (مفيهوش /video/<رقم> صريح) — الباك-إند
    // بيحفظ الرابط الخام زي ما هو (url)، بس بيحفظ الـID المستخرج فعليًا من oEmbed كمان.
    const link = await service.addLink(ids.techProfile, { url: 'https://vm.tiktok.com/ZMabc123/' });

    expect(link.platform).toBe(PortfolioLinkPlatform.TIKTOK);
    expect(link.embedVideoId).toBe('7123456789012345678');
    expect(link.thumbnailUrl).toBe('https://p16.tiktokcdn.com/thumb.jpg');

    const dto = toPortfolioLinkResponseDto(link);
    expect(dto.embed_video_id).toBe('7123456789012345678');
  });

  it('لينك تيك توك — فشل نداء oEmbed بره الشبكة: اللينك لسه بيتحفظ، embed_video_id بيفضل null', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network unreachable'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const link = await service.addLink(ids.techProfile, { url: 'https://vt.tiktok.com/ZTxyz456/' });

    expect(link.embedVideoId).toBeNull();
    expect(link.thumbnailUrl).toBeNull();
  });

  it('لينك يوتيوب — رد oEmbed مفيهوش embed_product_id أصلاً، embed_video_id بيفضل null عمداً (خارج نطاق البَقّة المبلّغة)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ thumbnail_url: 'https://i.ytimg.com/thumb.jpg', title: 'فيديو يوتيوب' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const link = await service.addLink(ids.techProfile, { url: 'https://youtu.be/dQw4w9WgXcQ' });

    expect(link.platform).toBe(PortfolioLinkPlatform.YOUTUBE);
    expect(link.embedVideoId).toBeNull();
    expect(link.thumbnailUrl).toBe('https://i.ytimg.com/thumb.jpg');
  });
});
