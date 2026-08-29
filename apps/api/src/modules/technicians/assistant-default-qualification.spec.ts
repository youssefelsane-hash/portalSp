import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { TechnicianServiceExclusionsService } from './technician-service-exclusions.service';
import { technicianServiceQualificationCondition } from './technician-eligibility.sql';

/**
 * ADR-0054 (docs/08 §103، طلب مالك) — «المساعد by default بيتقبل في كل، وأنا بس بدخل وبلغي
 * الطلب اللي هو ما بيعرفش يعمله».
 *
 * الاختبار حي على Postgres حقيقي عشان يغطّي **شرط الـSQL نفسه** مش دالة مساعدة — الشرط ده هو
 * اللي كل مسارات التوزيع بتناديه، فلو اتكسر مفيش حاجة تانية هتمسكه.
 *
 * الالتزام الأهم هنا: **الشاشة والمطابقة لازم يشوفوا نفس المجموعة**. لو افترقوا، الأدمن يحجب
 * حاجة والمطابقة تبعتها (أو العكس) — وده أسوأ من الفجوة الأصلية.
 */
describe('ADR-0054 — المساعد مؤهّل لكل الخدمات افتراضيًا', () => {
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
  async function isQualified(technicianId: string, serviceId: string, serviceApprovalRequired: boolean) {
    const condition = technicianServiceQualificationCondition({
      technicianIdExpr: 'tp.id',
      serviceIdExpr: 's.id',
      categoryIdExpr: 's.category_id',
      serviceApprovalRequired,
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
       VALUES ($1,$2,$3,'fixed',10000,true) RETURNING id`,
      [ids.category, `خدمة أ ${runId}`, `test-q-svc-a-${runId}`],
    );
    ids.serviceA = serviceA.id;
    const [serviceB] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,'fixed',10000,true) RETURNING id`,
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

    // الفني معتمد على الفئة الأولى بس — عشان نثبت إن سلوكه ما اتغيّرش.
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, verification_status, is_active)
       VALUES ($1,$2,'approved',true)`,
      [ids.technicianProfile, ids.category],
    );
    // المساعد **بلا أي اعتماد خالص** — ده الحال الغالب اللي المالك بيشتكي منه.
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

  it('المساعد بلا أي اعتماد مؤهّل للخدمتين — حتى اللي في فئة مالوش فيها حاجة', async () => {
    expect(await isQualified(ids.assistantProfile, ids.serviceA, false)).toBe(true);
    expect(await isQualified(ids.assistantProfile, ids.serviceB, false)).toBe(true);
  }, 20000);

  it('نفس المساعد بالشرط القديم (اعتماد مطلوب) مكانش مؤهّل لأي حاجة — ده كان جذر المشكلة', async () => {
    expect(await isQualified(ids.assistantProfile, ids.serviceA, true)).toBe(false);
    expect(await isQualified(ids.assistantProfile, ids.serviceB, true)).toBe(false);
  }, 20000);

  it('الحجب لسه شغّال على المساعد — هو أداة التحكم الوحيدة دلوقتي', async () => {
    await exclusions.exclude(ids.adminUser, ids.assistantProfile, ids.serviceA, 'مش بيعرف يعملها');
    expect(await isQualified(ids.assistantProfile, ids.serviceA, false)).toBe(false);
    // الخدمة التانية ما اتأثرتش — الحجب لكل خدمة على حدة.
    expect(await isQualified(ids.assistantProfile, ids.serviceB, false)).toBe(true);

    await exclusions.allow(ids.adminUser, ids.assistantProfile, ids.serviceA);
    expect(await isQualified(ids.assistantProfile, ids.serviceA, false)).toBe(true);
  }, 20000);

  it('سلوك الفني ما اتغيّرش بالحرف — معتمد على فئته بس، ومحجوب عن اللي برّاها', async () => {
    expect(await isQualified(ids.technicianProfile, ids.serviceA, true)).toBe(true);
    expect(await isQualified(ids.technicianProfile, ids.serviceB, true)).toBe(false);
  }, 20000);

  it('شاشة الأدمن بتعرض للمساعد كل الخدمات النشطة — مكانت بتفضل فاضية', async () => {
    const rows = await exclusions.listForTechnician(ids.assistantProfile);
    const serviceIds = rows.map((r) => r.service_id);
    expect(serviceIds).toContain(ids.serviceA);
    expect(serviceIds).toContain(ids.serviceB);
  }, 20000);

  it('شاشة الأدمن للفني بتفضل محصورة في اعتماداته', async () => {
    const rows = await exclusions.listForTechnician(ids.technicianProfile);
    const serviceIds = rows.map((r) => r.service_id);
    expect(serviceIds).toContain(ids.serviceA);
    expect(serviceIds).not.toContain(ids.serviceB);
  }, 20000);

  it('الشاشة والمطابقة بيشوفوا نفس المجموعة للمساعد — مفيش حاجة محجوبة بتوصله', async () => {
    await exclusions.exclude(ids.adminUser, ids.assistantProfile, ids.serviceB, 'خارج قدرته');
    const rows = await exclusions.listForTechnician(ids.assistantProfile);
    for (const row of rows) {
      const matchingSeesIt = await isQualified(ids.assistantProfile, row.service_id, false);
      expect(matchingSeesIt).toBe(!row.is_excluded);
    }
    await exclusions.allow(ids.adminUser, ids.assistantProfile, ids.serviceB);
  }, 20000);
});
