import { DataSource } from 'typeorm';
import { BookingMatchPreviewService } from './booking-match-preview.service';
import { BookingMatchPreview } from './entities/booking-match-preview.entity';

/**
 * **بلاغ مالك حقيقي (2026-09-06)**: «شخص واحد بس اسمه أحمد فني هو اللي عامل المشكلة — كل ما
 * أجي أختاره بيجيلي حصل خطأ غير متوقع». سجل الأعطال طلّع السبب:
 * `req_86942f97` / `req_58327a98` → خرق `chk_booking_match_preview_provider`.
 *
 * القيد بيفرض إن **واحد بالظبط** من (`technician_id`, `technician_company_id`) يبقى مليان،
 * والكود كان بيحط `chosen.company_id` — وهي شركة الفني المنتمي ليها، مش «المنفّذ شركة». فأي
 * فني تابع لشركة كان بينزل بالعمودين مليانين ⇒ 500 عند العميل. الفني المستقل كان بيعدّي لأن
 * `company_id` بتاعه NULL — وده بالظبط ليه «واحد بس» هو اللي بيقع.
 *
 * الاختبار بينادي `create()` الحقيقية على قاعدة بيانات حقيقية، مرة لفني تابع لشركة ومرة لفني
 * مستقل. الحالة الأولى كانت **بتفشل** قبل الإصلاح.
 */
describe('معاينة المطابقة لفني تابع لشركة (chk_booking_match_preview_provider)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    category: '', service: '', company: '',
    companyTech: '', companyTechUser: '', soloTech: '', soloTechUser: '',
    customer: '', customerProfile: '', address: '', city: '',
  };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  const pricing = {
    total_amount_cents: 25_000,
    duration_minutes: 60,
    estimated_duration_days: null,
    service_zone_id: null,
    booking_mode: 'individual',
  };

  const makeTechnician = async (label: string, companyId: string | null): Promise<{ profileId: string; userId: string }> => {
    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2094${runId}${label}`.slice(0, 15), `فني ${label} ${runId}`],
    );
    const [p] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, company_id, current_location)
       VALUES ($1,$2,'approved',$3, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) RETURNING id`,
      [u.id, `BMP-${runId}-${label}`, companyId],
    );
    return { profileId: p.id, userId: u.id };
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [BookingMatchPreview],
    });
    await dataSource.initialize();

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`معاينة ${runId}`, `bmp ${runId}`, `bmp-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, estimated_duration_minutes, pricing_model)
       VALUES ($1,$2,$3,$4,25000,60,'formula') RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc ${runId}`, `bmp-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `bmp-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [cu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2093${runId}`.slice(0, 15), `عميل ${runId}`],
    );
    ids.customer = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customer]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, label, street_name, city_id, location)
       VALUES ($1,'بيت','شارع',$2,ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) RETURNING id`,
      [ids.customer, ids.city],
    );
    ids.address = addr.id;

    // الشركة لازم يبقى ليها مالك — بنعمل الفني التابع الأول ونخليه مالكها، زي الواقع بالظبط.
    const inCompany = await makeTechnician('C', null);
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1, $2, true) RETURNING id`,
      [inCompany.userId, `شركة ${runId}`],
    );
    ids.company = company.id;
    await q(`UPDATE technician_profiles SET company_id = $1 WHERE id = $2`, [ids.company, inCompany.profileId]);
    ids.companyTech = inCompany.profileId;
    ids.companyTechUser = inCompany.userId;
    const solo = await makeTechnician('S', null);
    ids.soloTech = solo.profileId;
    ids.soloTechUser = solo.userId;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const alive = (id: string): string[] => (id ? [id] : []);
    try {
      if (ids.customerProfile) await q(`DELETE FROM booking_match_previews WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id = ANY($1)`, [alive(ids.address)]);
      await q(`DELETE FROM customer_profiles WHERE id = ANY($1)`, [alive(ids.customerProfile)]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [[...alive(ids.companyTech), ...alive(ids.soloTech)]]);
      await q(`DELETE FROM technician_companies WHERE id = ANY($1)`, [alive(ids.company)]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[...alive(ids.customer), ...alive(ids.companyTechUser), ...alive(ids.soloTechUser)]]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [alive(ids.service)]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [alive(ids.category)]);
      await q(`DELETE FROM cities WHERE id = ANY($1)`, [alive(ids.city)]);
    } finally {
      await dataSource.destroy();
    }
  });

  /**
   * الخدمة الحقيقية بمتعاونين مُجهّزين — كل اللي بيتبدّل هو **المرشّح اللي المطابقة بترجّعه**
   * (تابع لشركة أو مستقل). الحفظ نفسه بيروح على قاعدة البيانات الحقيقية بقيدها الحقيقي.
   */
  const buildService = (technicianId: string, companyId: string | null): BookingMatchPreviewService =>
    new BookingMatchPreviewService(
      dataSource.getRepository(BookingMatchPreview),
      { findByUserIdOrThrow: async () => ({ id: ids.customerProfile }) } as never,
      { previewPrice: async () => pricing } as never,
      {
        findEligibleTechnicians: async () => [
          { technician_id: technicianId, company_id: companyId, distance_km: '1.5' },
        ],
      } as never,
      {
        getPublicProfile: async () => ({
          profile: { id: technicianId, currentLevel: 'beginner', averageRating: '4.5', totalRatingsCount: 3, completedOrdersCount: 2 },
          fullName: 'فني',
          avatarUrl: null,
          avatarStorageKey: null,
        }),
      } as never,
      { getNumber: async (_k: string, fallback: number) => fallback } as never,
      {} as never,
    );

  const createPreview = (technicianId: string, companyId: string | null) =>
    buildService(technicianId, companyId).create(ids.customer, {
      service_id: ids.service,
      address_id: ids.address,
      selection_mode: 'manual',
      technician_id: technicianId,
    } as never);

  it('فني تابع لشركة: التذكرة بتتحفظ، وعمود الشركة بيفضل فاضي', async () => {
    const preview = await createPreview(ids.companyTech, ids.company);
    const [row] = await q<{ technician_id: string; technician_company_id: string | null }>(
      `SELECT technician_id, technician_company_id FROM booking_match_previews WHERE id = $1`,
      [preview.match_preview_id],
    );
    expect(row.technician_id).toBe(ids.companyTech);
    // ده جوهر الإصلاح: المنفّذ فرد، فعمود الشركة لازم يفضل NULL وإلا القيد بيرفض الصف.
    expect(row.technician_company_id).toBeNull();
  });

  it('الفني المستقل زي ما هو (الحالة اللي كانت بتعدّي أصلاً)', async () => {
    const preview = await createPreview(ids.soloTech, null);
    const [row] = await q<{ technician_company_id: string | null }>(
      `SELECT technician_company_id FROM booking_match_previews WHERE id = $1`,
      [preview.match_preview_id],
    );
    expect(row.technician_company_id).toBeNull();
  });

  it('القيد نفسه حقيقي: صف بالعمودين مليانين بيترفض من قاعدة البيانات', async () => {
    await expect(
      q(
        `INSERT INTO booking_match_previews
           (customer_id, service_id, address_id, technician_id, technician_company_id,
            selection_mode, context_hash, pricing_snapshot, final_price_cents, expires_at)
         VALUES ($1,$2,$3,$4,$5,'manual','x','{}'::jsonb, 100, now() + interval '5 minutes')`,
        [ids.customerProfile, ids.service, ids.address, ids.companyTech, ids.company],
      ),
    ).rejects.toThrow(/chk_booking_match_preview_provider/);
  });
});
