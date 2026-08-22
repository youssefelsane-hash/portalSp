import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TechnicianCompaniesService } from './technician-companies.service';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianCompanyBranch } from './entities/technician-company-branch.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { User } from '../auth/entities/user.entity';

/**
 * ADR-0031 — "أسهل وأسرع طريقة" لصورة شخصية للشركة بطلب صريح من المالك: مفيش رفع/تخزين منفصل
 * للشركة خالص، بنستخدم أفتار المالك المعتمد (users.avatar_storage_key) نفسه. الاختبار ده بيتأكد
 * إن listActiveForCustomers()/countBranchesAndStaff() بيرجّعوا صورة المالك صح (والقيمة null لو
 * المالك لسه معندوش صورة معتمدة، بدل ما يرمي أو يرجّع قيمة غلط).
 */
describe('TechnicianCompaniesService — صورة الشركة = أفتار المالك المعتمد (ADR-0031)', () => {
  let dataSource: DataSource;
  let service: TechnicianCompaniesService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { ownerWithAvatar: '', ownerNoAvatar: '', companyWithAvatar: '', companyNoAvatar: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianCompany, TechnicianCompanyBranch, TechnicianProfile, User],
    });
    await dataSource.initialize();

    const [ownerWithAvatar] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, avatar_storage_key) VALUES ($1,$2,'technician',$3) RETURNING id`,
      [`+2060${runId}`.slice(0, 15), `مالك شركة بصورة ${runId}`, `technician-documents/owner-${runId}/photo.jpg`],
    );
    ids.ownerWithAvatar = ownerWithAvatar.id;
    const [ownerNoAvatar] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2061${runId}`.slice(0, 15),
      `مالك شركة من غير صورة ${runId}`,
    ]);
    ids.ownerNoAvatar = ownerNoAvatar.id;

    const [companyWithAvatar] = await q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
      [ids.ownerWithAvatar, `شركة بصورة ${runId}`],
    );
    ids.companyWithAvatar = companyWithAvatar.id;
    const [companyNoAvatar] = await q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
      [ids.ownerNoAvatar, `شركة من غير صورة ${runId}`],
    );
    ids.companyNoAvatar = companyNoAvatar.id;

    service = new TechnicianCompaniesService(
      dataSource,
      dataSource.getRepository(TechnicianCompany),
      dataSource.getRepository(TechnicianCompanyBranch),
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(User),
      { record: async () => undefined } as never,
      {} as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_companies WHERE id IN ($1,$2)`, [ids.companyWithAvatar, ids.companyNoAvatar]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.ownerWithAvatar, ids.ownerNoAvatar]);
    } finally {
      await dataSource.destroy();
    }
  }, 15000);

  it('شركة مالكها عنده صورة معتمدة: ownerAvatarStorageKey بيترجع صح', async () => {
    const rows = await service.listActiveForCustomers();
    const row = rows.find((r) => r.company.id === ids.companyWithAvatar);
    expect(row).toBeDefined();
    expect(row!.ownerAvatarStorageKey).toBe(`technician-documents/owner-${runId}/photo.jpg`);
  });

  it('شركة مالكها من غير صورة: null صريح، صفر رمي/كسر', async () => {
    const rows = await service.listActiveForCustomers();
    const row = rows.find((r) => r.company.id === ids.companyNoAvatar);
    expect(row).toBeDefined();
    expect(row!.ownerAvatarStorageKey).toBeNull();
    expect(row!.ownerAvatarUrl).toBeNull();
  });
});
