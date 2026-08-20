import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { TechnicianCategory } from '../catalog/entities/technician-category.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianCategoriesService } from './technician-categories.service';

// اختبار حي ضد Postgres حقيقي — §29 (طلب مالك صريح 2026-08-20): الأدمن لازم يقدر يعيّن/يشيل
// فئة/تخصص لفني مباشرة من بروفايله (كارت "التخصصات")، من غير ما ينتظر تصريح ذاتي من الفني الأول.
// بيثبت: (1) التعيين المباشر idempotent (نداء تاني بلا خطأ/تكرار)، (2) تعيين فوق تصريح ذاتي
// pending بيحوّله approved+active مباشرة (الأدمن أسرع من انتظار المراجعة)، (3) الإزالة soft
// (is_active=false بس، السجل والتاريخ فاضلين) ومش بتأثر على تعيين تاني بعد كده.
describe('TechnicianCategoriesService — تعيين مباشر من الأدمن (§29)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechnicianCategoriesService;
  const recordedAudit: unknown[] = [];

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    categoryA: '',
    categoryB: '',
    technicianUser: '',
    technicianProfile: '',
    adminUser: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianCategory, ServiceCategory, TechnicianProfile],
    });
    await dataSource.initialize();

    service = new TechnicianCategoriesService(
      dataSource.getRepository(TechnicianCategory),
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(ServiceCategory),
      { emit: jest.fn() } as never,
      { record: jest.fn(async (entry: unknown) => recordedAudit.push(entry)) } as never,
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [categoryA] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار أ ${runId}`,
      `Test Category A ${runId}`,
      `test-cat-admin-a-${runId}`,
    ]);
    ids.categoryA = categoryA.id;
    const [categoryB] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار ب ${runId}`,
      `Test Category B ${runId}`,
      `test-cat-admin-b-${runId}`,
    ]);
    ids.categoryB = categoryB.id;

    const [technicianUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2014${runId}`.slice(0, 14),
      `فني اختبار ${runId}`,
    ]);
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,'new','approved') RETURNING id`,
      [ids.technicianUser, `ADMCAT${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2015${runId}`.slice(0, 14),
      `أدمن اختبار ${runId}`,
    ]);
    ids.adminUser = adminUser.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      await q(`DELETE FROM technician_categories WHERE technician_id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.technicianUser, ids.adminUser]);
      await q(`DELETE FROM service_categories WHERE id IN ($1,$2)`, [ids.categoryA, ids.categoryB]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('تعيين مباشر من الصفر بيعمل صف approved+active على طول', async () => {
    const row = await service.adminAssignCategory(ids.adminUser, ids.technicianProfile, ids.categoryA, undefined);
    expect(row.verificationStatus).toBe('approved');
    expect(row.isActive).toBe(true);
    expect(row.isSelfDeclared).toBe(false);
    expect(row.reviewedByUserId).toBe(ids.adminUser);
  });

  it('نداء تاني لنفس الفئة المعتمدة بالفعل idempotent — صفر صف تاني، صفر سجل تدقيق إضافي', async () => {
    const before = recordedAudit.length;
    const row = await service.adminAssignCategory(ids.adminUser, ids.technicianProfile, ids.categoryA, undefined);
    expect(row.verificationStatus).toBe('approved');
    expect(row.isActive).toBe(true);
    expect(recordedAudit.length).toBe(before); // idempotent — مفيش سجل تدقيق جديد لحالة متكررة

    const rows = await dataSource.query(`SELECT id FROM technician_categories WHERE technician_id = $1 AND category_id = $2`, [
      ids.technicianProfile,
      ids.categoryA,
    ]);
    expect(rows).toHaveLength(1); // صف واحد بس، مفيش تكرار
  });

  it('تعيين مباشر فوق تصريح ذاتي pending بيحوّله approved+active مباشرة (الأدمن أسرع من طابور المراجعة)', async () => {
    await service.declareCategory(ids.technicianUser, { category_id: ids.categoryB });
    const pendingRows = await dataSource.query(
      `SELECT verification_status FROM technician_categories WHERE technician_id = $1 AND category_id = $2`,
      [ids.technicianProfile, ids.categoryB],
    );
    expect(pendingRows[0].verification_status).toBe('pending_verification');

    const row = await service.adminAssignCategory(ids.adminUser, ids.technicianProfile, ids.categoryB, undefined);
    expect(row.verificationStatus).toBe('approved');
    expect(row.isActive).toBe(true);
  });

  it('الإزالة soft — is_active بس بيتشال، السجل والتاريخ فاضلين، وتعيين تاني بعدها بيرجّعها نشطة', async () => {
    await service.adminRemoveCategory(ids.adminUser, ids.technicianProfile, ids.categoryA, undefined);
    const afterRemove = await dataSource.query(
      `SELECT is_active, verification_status FROM technician_categories WHERE technician_id = $1 AND category_id = $2`,
      [ids.technicianProfile, ids.categoryA],
    );
    expect(afterRemove[0].is_active).toBe(false);
    expect(afterRemove[0].verification_status).toBe('approved'); // السجل التاريخي فاضل زي ما هو

    const row = await service.adminAssignCategory(ids.adminUser, ids.technicianProfile, ids.categoryA, undefined);
    expect(row.isActive).toBe(true);
  });

  it('إزالة فئة مش معيّنة أصلاً بترفض بوضوح', async () => {
    await expect(service.adminRemoveCategory(ids.adminUser, ids.technicianProfile, randomUUID(), undefined)).rejects.toThrow(ApiException);
  });

  it('تعيين لفئة غير موجودة بيرفض بوضوح', async () => {
    await expect(service.adminAssignCategory(ids.adminUser, ids.technicianProfile, randomUUID(), undefined)).rejects.toThrow(ApiException);
  });
});
