import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TechnicianZone } from './entities/technician-zone.entity';
import { TechnicianProfile, TechnicianLevel, TechnicianPricingTier } from './entities/technician-profile.entity';
import { TechnicianDocument } from './entities/technician-document.entity';
import { TechnicianLevelHistory } from './entities/technician-level-history.entity';
import { TechnicianService as TechnicianServiceEntity } from '../catalog/entities/technician-service.entity';
import { Service } from '../catalog/entities/service.entity';
import { User } from '../auth/entities/user.entity';
import { AdminTechniciansService } from './admin-technicians.service';

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — اختبار حي: changePricingTier() منفصل تمامًا عن
// changeLevel() (كل واحد بيغيّر عموده بس)، وبيرفض 409 لو نفس الفئة الحالية (نفس نمط changeLevel()).
describe('AdminTechniciansService.changePricingTier() — منفصل تمامًا عن changeLevel() (§36.24)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: AdminTechniciansService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { country: '', city: '', technicianUser: '', technicianProfile: '', adminUser: '' };

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianZone, TechnicianProfile, TechnicianDocument, TechnicianLevelHistory, TechnicianServiceEntity, Service, User],
    });
    await dataSource.initialize();

    service = new AdminTechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianDocument),
      dataSource.getRepository(TechnicianLevelHistory),
      dataSource.getRepository(TechnicianZone),
      dataSource.getRepository(TechnicianServiceEntity),
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      { emit: jest.fn() } as never,
      { record: jest.fn(async () => undefined) } as never,
      { findServiceZoneOrThrow: async (id: string) => ({ id }) } as never,
    );

    // نفس بَقّة نظافة الاختبارات اللي اتصلحت في matching-work-opportunity.spec.ts (§63 شريحة 5):
    // إنشاء دولة بـiso_code عشوائي من حرفين مساحته صغيرة جدًا واحتمال تصادمه عالي، وتنظيف
    // afterAll بيفشل على قيود المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم
    // مسألة وقت. بنستعمل دولة موجودة أصلاً بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة فئة فني ${runId}`,
      `Tier Assign City ${runId}`,
      `tier-assign-city-${runId}`,
    ]);
    ids.city = city.id;

    const [technicianUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2018${runId}`.slice(0, 14),
      `فني فئة تسعير ${runId}`,
    ]);
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, pricing_tier, verification_status)
       VALUES ($1,$2,'professional','standard','approved') RETURNING id`,
      [ids.technicianUser, `TIERASN${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2019${runId}`.slice(0, 14),
      `أدمن فئة تسعير ${runId}`,
    ]);
    ids.adminUser = adminUser.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_level_history WHERE technician_id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.technicianUser, ids.adminUser]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  }, 15000);

  it('changePricingTier() بيغيّر pricing_tier بس، وcurrent_level التشغيلي يفضل زي ما هو بالحرف', async () => {
    const { profile } = await service.changePricingTier(ids.adminUser, ids.technicianProfile, {
      pricing_tier: TechnicianPricingTier.PREMIUM,
    } as never);
    expect(profile.pricingTier).toBe(TechnicianPricingTier.PREMIUM);
    expect(profile.currentLevel).toBe(TechnicianLevel.PROFESSIONAL);
  });

  it('changeLevel() بيغيّر current_level بس، وpricing_tier التجاري يفضل زي ما هو بالحرف (استقلال في الاتجاه العكسي)', async () => {
    const { profile } = await service.changeLevel(ids.adminUser, ids.technicianProfile, { level: TechnicianLevel.PREMIUM } as never);
    expect(profile.currentLevel).toBe(TechnicianLevel.PREMIUM);
    // التغيير السابق (premium) لسه ساري — changeLevel() ملوش أي أثر عليه.
    expect(profile.pricingTier).toBe(TechnicianPricingTier.PREMIUM);
  });

  it('changePricingTier() بترفض 409 لو الفني أصلاً على نفس الفئة', async () => {
    await expect(
      service.changePricingTier(ids.adminUser, ids.technicianProfile, { pricing_tier: TechnicianPricingTier.PREMIUM } as never),
    ).rejects.toMatchObject({ status: 409 });
  });
});
