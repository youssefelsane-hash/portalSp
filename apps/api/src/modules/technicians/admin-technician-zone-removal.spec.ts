import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TechnicianZone } from './entities/technician-zone.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianDocument } from './entities/technician-document.entity';
import { TechnicianLevelHistory } from './entities/technician-level-history.entity';
import { TechnicianService as TechnicianServiceEntity } from '../catalog/entities/technician-service.entity';
import { Service } from '../catalog/entities/service.entity';
import { User } from '../auth/entities/user.entity';
import { AdminTechniciansService } from './admin-technicians.service';

// اختبار حي — بَقّة حقيقية اتلقطت وقت تحقيق §36.1 (docs/08): AdminTechniciansService.removeZone()
// كان بيعمل soft-delete بس (deleted_at)، بدون ما يقلب is_active=false. استعلامات المطابقة الخام
// (matching.service.ts وغيرها، ~5 أماكن) بتفلتر بـ`tz.is_active = true` بس من غير فحص deleted_at —
// يعني منطقة "متشالة" فعليًا كانت لسه بتطابق. الإصلاح: نقطة كتابة واحدة (isActive:false) بدل
// تعديل كل استعلامات القراءة المكرّرة.
describe('AdminTechniciansService.removeZone() — إلغاء تفعيل حقيقي مش soft-delete بس (§36.1)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: AdminTechniciansService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { country: '', city: '', zone: '', technicianUser: '', technicianProfile: '', adminUser: '' };

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

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة إزالة منطقة ${runId}`,
      `Zone Removal City ${runId}`,
      `test-zone-removal-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق إزالة منطقة ${runId}`,
      `Zone Removal Zone ${runId}`,
    ]);
    ids.zone = zone.id;

    const [technicianUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2016${runId}`.slice(0, 14),
      `فني إزالة منطقة ${runId}`,
    ]);
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,'new','approved') RETURNING id`,
      [ids.technicianUser, `ZONEDEL${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2017${runId}`.slice(0, 14),
      `أدمن إزالة منطقة ${runId}`,
    ]);
    ids.adminUser = adminUser.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.technicianUser, ids.adminUser]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  }, 15000);

  it('removeZone() بيقلب is_active=false مع الـsoft-delete، مش deleted_at بس', async () => {
    await service.assignZone(ids.adminUser, ids.technicianProfile, { service_zone_id: ids.zone, is_primary: false });
    await service.removeZone(ids.adminUser, ids.technicianProfile, ids.zone);

    const [row] = await q(`SELECT is_active, deleted_at FROM technician_zones WHERE technician_id = $1 AND service_zone_id = $2`, [
      ids.technicianProfile,
      ids.zone,
    ]);
    expect(row.is_active).toBe(false);
    expect(row.deleted_at).not.toBeNull();
  });

  it('نفس شرط الـJOIN الخام اللي matching.service.ts بيستخدمه ميطابقش المنطقة المتشالة بعد الإصلاح', async () => {
    await service.assignZone(ids.adminUser, ids.technicianProfile, { service_zone_id: ids.zone, is_primary: false });
    await service.removeZone(ids.adminUser, ids.technicianProfile, ids.zone);

    // نفس شرط JOIN بالحرف من matching.service.ts:210 (tz.is_active = true فقط) — لو الإصلاح
    // مش موجود، الصف ده كان هيرجع رغم إنه "متشال" فعليًا (deleted_at IS NOT NULL).
    const rows = await q(
      `SELECT tz.id FROM technician_zones tz WHERE tz.technician_id = $1 AND tz.service_zone_id = $2 AND tz.is_active = true`,
      [ids.technicianProfile, ids.zone],
    );
    expect(rows).toHaveLength(0);
  });
});
