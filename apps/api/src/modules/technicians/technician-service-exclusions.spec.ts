import { DataSource } from 'typeorm';
import { technicianServiceQualificationCondition } from './technician-eligibility.sql';

/**
 * ADR-0049 / docs/08 §86 — «الديفولت إن هو فعلاً بيروح كله، ولكن لو الأدمين حابب بيحجب عنه
 * حاجة بيخش عنده ويحجبها».
 *
 * **الاختبار ده بينفّذ الشرط الموحّد على قاعدة بيانات حقيقية**، مش بيقرا الكود. ده مقصود: الشرط
 * ده هو اللي كل مسارات التوزيع والاختيار التسعة بتناديها، فلو اتكسر فيه حاجة (اسم عمود، منطق
 * الـNOT EXISTS، تعامل الـalias) لازم يبان هنا مش في الإنتاج.
 */
describe('حجب خدمات عن فني (ADR-0049)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    techUser: '', tech: '', category: '', serviceA: '', serviceB: '', otherCategory: '', serviceC: '', adminUser: '',
  };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  /** بينفّذ شرط الأهلية الموحّد نفسه على فني/خدمة بعينهم — نفس النص اللي المطابقة بتستخدمه. */
  const isQualified = async (technicianId: string, serviceId: string): Promise<boolean> => {
    const [row] = await q<{ ok: boolean }>(
      `SELECT (${technicianServiceQualificationCondition({
        technicianIdExpr: '$1',
        serviceIdExpr: '$2',
        categoryIdExpr: 's.category_id',
      })}) AS ok
       FROM services s WHERE s.id = $2`,
      [technicianId, serviceId],
    );
    return row.ok;
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();

    const [au] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2091${runId}`.slice(0, 15), `أدمن حجب ${runId}`],
    );
    ids.adminUser = au.id;
    const [tu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2092${runId}`.slice(0, 15), `فني حجب ${runId}`],
    );
    ids.techUser = tu.id;
    const [tp] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status)
       VALUES ($1,$2,'approved') RETURNING id`,
      [ids.techUser, `TEXC-${runId}`],
    );
    ids.tech = tp.id;

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`سباكة ${runId}`, `plumb ${runId}`, `plumb-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [other] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`كهرباء ${runId}`, `elec ${runId}`, `elec-${runId.toLowerCase()}`],
    );
    ids.otherCategory = other.id;

    const mkService = async (categoryId: string, label: string) => {
      const [svc] = await q(
        `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, pricing_model)
         VALUES ($1,$2,$3,$4,10000,'fixed') RETURNING id`,
        [categoryId, `${label} ${runId}`, `${label} ${runId}`, `${label}-${runId.toLowerCase()}`],
      );
      return svc.id as string;
    };
    ids.serviceA = await mkService(ids.category, 'تركيب-حنفية');
    ids.serviceB = await mkService(ids.category, 'تسليك-مجاري');
    ids.serviceC = await mkService(ids.otherCategory, 'تمديد-كهرباء');

    // الفني معتمد في فئة السباكة كلها — ومش معتمد في الكهرباء خالص.
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [ids.tech, ids.category],
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_excluded_services WHERE technician_id = $1`, [ids.tech]);
      await q(`DELETE FROM technician_categories WHERE technician_id = $1`, [ids.tech]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceA, ids.serviceB, ids.serviceC]]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [[ids.category, ids.otherCategory]]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.tech]);
      await q(`DELETE FROM notification_campaign_sends WHERE user_id = ANY($1)`, [[ids.techUser, ids.adminUser]]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.techUser, ids.adminUser]]);
    } finally {
      await dataSource.destroy();
    }
  });

  // ده الديفولت اللي المالك وصفه: اعتماد الفئة ⇒ كل خدماتها شغّالة، بلا أي صف إضافي.
  it('الديفولت: اعتماد الفئة معناه كل خدماتها مسموحة', async () => {
    expect(await isQualified(ids.tech, ids.serviceA)).toBe(true);
    expect(await isQualified(ids.tech, ids.serviceB)).toBe(true);
  });

  it('فئة مش معتمدة: مش مؤهّل — الحجب مالوش علاقة بده', async () => {
    expect(await isQualified(ids.tech, ids.serviceC)).toBe(false);
  });

  it('بعد الحجب: الخدمة المحجوبة بس بتتقفل، والباقي زي ما هو', async () => {
    await q(
      `INSERT INTO technician_excluded_services (technician_id, service_id, reason, excluded_by_user_id)
       VALUES ($1,$2,$3,$4)`,
      [ids.tech, ids.serviceB, 'شكاوى متكررة على الشغلانة دي', ids.adminUser],
    );

    expect(await isQualified(ids.tech, ids.serviceB)).toBe(false);
    // **أهم تأكيد في الملف**: الحجب دقيق على الخدمة، مش بيلغي اعتماد الفئة كلها.
    expect(await isQualified(ids.tech, ids.serviceA)).toBe(true);
  });

  it('رفع الحجب بيرجّع الخدمة فورًا', async () => {
    await q(`DELETE FROM technician_excluded_services WHERE technician_id = $1 AND service_id = $2`, [
      ids.tech,
      ids.serviceB,
    ]);
    expect(await isQualified(ids.tech, ids.serviceB)).toBe(true);
  });

  // اعتماد الخدمة المباشر (`technician_services`) أقوى من الفئة في التأهيل — بس **مش** أقوى من
  // الحجب. غير كده كان الأدمن يحجب خدمة والفني يفضل واصله شغلها لأن عنده صف مباشر قديم.
  it('الحجب بيغلب حتى الاعتماد المباشر على الخدمة', async () => {
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [ids.tech, ids.serviceC],
    );
    expect(await isQualified(ids.tech, ids.serviceC)).toBe(true);

    await q(
      `INSERT INTO technician_excluded_services (technician_id, service_id, excluded_by_user_id)
       VALUES ($1,$2,$3)`,
      [ids.tech, ids.serviceC, ids.adminUser],
    );
    expect(await isQualified(ids.tech, ids.serviceC)).toBe(false);

    await q(`DELETE FROM technician_services WHERE technician_id = $1 AND service_id = $2`, [ids.tech, ids.serviceC]);
  });

  // الشرط بيتحقن في استعلامات ليها أشكال مختلفة (LEFT JOIN alias مقابل EXISTS مبني جوّه الدالة).
  // الفرعين لازم يدّوا نفس النتيجة بالظبط، وإلا مسار من التسعة هيتصرف بشكل مختلف بصمت.
  it('فرع الـalias وفرع الـEXISTS بيدّوا نفس النتيجة', async () => {
    const [row] = await q<{ with_alias: boolean; without_alias: boolean }>(
      `SELECT
         (${technicianServiceQualificationCondition({
           technicianIdExpr: 'tp.id',
           serviceIdExpr: 's.id',
           categoryIdExpr: 's.category_id',
           directServiceAlias: 'ts',
         })}) AS with_alias,
         (${technicianServiceQualificationCondition({
           technicianIdExpr: 'tp.id',
           serviceIdExpr: 's.id',
           categoryIdExpr: 's.category_id',
         })}) AS without_alias
       FROM technician_profiles tp
       JOIN services s ON s.id = $2
       LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = s.id
         AND ts.is_active = true AND ts.verification_status = 'approved'
       WHERE tp.id = $1`,
      [ids.tech, ids.serviceA],
    );
    expect(row.with_alias).toBe(row.without_alias);
  });
});
