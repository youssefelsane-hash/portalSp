import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { TechnicianServiceExclusionsService } from './technician-service-exclusions.service';
import { technicianServiceQualificationCondition } from './technician-eligibility.sql';

/** اختبار حي يثبت إن المساعد يمر بنفس دورة اعتماد التخصص، مع تطابق شاشة الأدمن والمطابقة. */
describe('اعتماد تخصص المساعد — نفس جدار الفني بين الصنايع', () => {
  let dataSource: DataSource;
  let exclusions: TechnicianServiceExclusionsService;
  const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);

  const ids = {
    category: '',
    otherCategory: '',
    serviceA: '',
    serviceB: '',
    assistantUser: '',
    assistantProfile: '',
    technicianUser: '',
    technicianProfile: '',
    adminUser: '',
  };

  const q = <T = any>(sql: string, params?: unknown[]): Promise<T[]> => dataSource.query(sql, params);

  /** بينفّذ شرط الأهلية الحقيقي على فني/خدمة بعينهم — نفس النص اللي المطابقة بتحقنه بالحرف. */
  async function isQualified(technicianId: string, serviceId: string) {
    const condition = technicianServiceQualificationCondition({
      technicianIdExpr: 'tp.id',
      serviceIdExpr: 's.id',
      categoryIdExpr: 's.category_id',
    });
    const [row] = await q<{ ok: boolean }>(
      `SELECT (${condition}) AS ok
         FROM technician_profiles tp, services s
        WHERE tp.id = $1 AND s.id = $2`,
      [technicianId, serviceId],
    );
    return row.ok;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    exclusions = new TechnicianServiceExclusionsService(dataSource, {
      record: async () => undefined,
    } as unknown as AuditLogService);

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تأهيل ${runId}`,
      `Qual Category ${runId}`,
      `test-q-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [otherCategory] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة تانية ${runId}`, `Other Category ${runId}`, `test-q-cat2-${runId}`],
    );
    ids.otherCategory = otherCategory.id;

    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,'formula',10000,true) RETURNING id`,
      [ids.category, `خدمة أ ${runId}`, `test-q-svc-a-${runId}`],
    );
    ids.serviceA = serviceA.id;
    const [serviceB] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,'formula',10000,true) RETURNING id`,
      [ids.otherCategory, `خدمة ب ${runId}`, `test-q-svc-b-${runId}`],
    );
    ids.serviceB = serviceB.id;

    const mk = async (label: string, kind: 'technician' | 'assistant') => {
      const [u] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2099${label}${runId}`.slice(0, 15),
        `${label} ${runId}`,
      ]);
      const [p] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience,
                                          current_level, verification_status, technician_kind)
         VALUES ($1,$2,'x',1,'new','approved',$3) RETURNING id`,
        [u.id, `Q-${label}-${runId}`.slice(0, 20), kind],
      );
      return { userId: u.id as string, profileId: p.id as string };
    };
    // أدمن حقيقي — `technician_excluded_services.excluded_by_user_id` عليه مفتاح أجنبي، فقيمة
    // وهمية بترفض من الداتابيز (اتلقطت بالتشغيل الحي).
    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2098${runId}`.slice(0, 15), `أدمن تأهيل ${runId}`],
    );
    ids.adminUser = adminUser.id;

    const assistant = await mk('asst', 'assistant');
    ids.assistantUser = assistant.userId;
    ids.assistantProfile = assistant.profileId;
    const technician = await mk('tech', 'technician');
    ids.technicianUser = technician.userId;
    ids.technicianProfile = technician.profileId;

    // الدوران معتمدان على الفئة الأولى فقط؛ الدور لا يفتح فئات أخرى تلقائيًا.
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, verification_status, is_active)
       VALUES ($1,$3,'approved',true),($2,$3,'approved',true)`,
      [ids.technicianProfile, ids.assistantProfile, ids.category],
    );
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const profiles = [ids.assistantProfile, ids.technicianProfile];
    try {
      await q(`DELETE FROM technician_excluded_services WHERE technician_id = ANY($1::uuid[])`, [profiles]);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [profiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [profiles]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.assistantUser, ids.technicianUser, ids.adminUser]]);
      await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.serviceA, ids.serviceB]]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1::uuid[])`, [[ids.category, ids.otherCategory]]);
    } finally {
      await dataSource.destroy();
    }
  }, 20000);

  it('المساعد مؤهّل داخل فئته المعتمدة فقط، ولا يتسرّب لفئة أخرى', async () => {
    expect(await isQualified(ids.assistantProfile, ids.serviceA)).toBe(true);
    expect(await isQualified(ids.assistantProfile, ids.serviceB)).toBe(false);
  }, 20000);

  it('المساعد بلا اعتماد لا يظهر لأي تخصص لحد موافقة الأدمن', async () => {
    await q(`DELETE FROM technician_categories WHERE technician_id = $1`, [ids.assistantProfile]);
    try {
      expect(await isQualified(ids.assistantProfile, ids.serviceA)).toBe(false);
      expect(await isQualified(ids.assistantProfile, ids.serviceB)).toBe(false);
    } finally {
      await q(
        `INSERT INTO technician_categories (technician_id, category_id, verification_status, is_active)
         VALUES ($1,$2,'approved',true)`,
        [ids.assistantProfile, ids.category],
      );
    }
  }, 20000);

  it('تغيير نفس الشخص بين فني ومساعد لا يخلق له اعتمادًا وهميًا', async () => {
    expect(await isQualified(ids.technicianProfile, ids.serviceB)).toBe(false);
    await q(`UPDATE technician_profiles SET technician_kind = 'assistant' WHERE id = $1`, [ids.technicianProfile]);
    try {
      expect(await isQualified(ids.technicianProfile, ids.serviceA)).toBe(true);
      expect(await isQualified(ids.technicianProfile, ids.serviceB)).toBe(false);
    } finally {
      await q(`UPDATE technician_profiles SET technician_kind = 'technician' WHERE id = $1`, [ids.technicianProfile]);
    }
  }, 20000);

  it('الحجب الإضافي يظل شغالًا داخل تخصص المساعد المعتمد', async () => {
    await exclusions.exclude(ids.adminUser, ids.assistantProfile, ids.serviceA, 'مش بيعرف يعملها');
    expect(await isQualified(ids.assistantProfile, ids.serviceA)).toBe(false);
    expect(await isQualified(ids.assistantProfile, ids.serviceB)).toBe(false);

    await exclusions.allow(ids.adminUser, ids.assistantProfile, ids.serviceA);
    expect(await isQualified(ids.assistantProfile, ids.serviceA)).toBe(true);
  }, 20000);

  it('سلوك الفني ما اتغيّرش بالحرف — معتمد على فئته بس، ومحجوب عن اللي برّاها', async () => {
    expect(await isQualified(ids.technicianProfile, ids.serviceA)).toBe(true);
    expect(await isQualified(ids.technicianProfile, ids.serviceB)).toBe(false);
  }, 20000);

  it('شاشة الأدمن بتعرض للمساعد خدمات تخصصه المعتمد فقط', async () => {
    const rows = await exclusions.listForTechnician(ids.assistantProfile);
    const serviceIds = rows.map((r) => r.service_id);
    expect(serviceIds).toContain(ids.serviceA);
    expect(serviceIds).not.toContain(ids.serviceB);
  }, 20000);

  it('شاشة الأدمن للفني بتفضل محصورة في اعتماداته', async () => {
    const rows = await exclusions.listForTechnician(ids.technicianProfile);
    const serviceIds = rows.map((r) => r.service_id);
    expect(serviceIds).toContain(ids.serviceA);
    expect(serviceIds).not.toContain(ids.serviceB);
  }, 20000);

  it('الشاشة والمطابقة بيشوفوا نفس المجموعة للمساعد', async () => {
    const rows = await exclusions.listForTechnician(ids.assistantProfile);
    for (const row of rows) {
      const matchingSeesIt = await isQualified(ids.assistantProfile, row.service_id);
      expect(matchingSeesIt).toBe(!row.is_excluded);
    }
    expect(await isQualified(ids.assistantProfile, ids.serviceB)).toBe(false);
  }, 20000);
});
