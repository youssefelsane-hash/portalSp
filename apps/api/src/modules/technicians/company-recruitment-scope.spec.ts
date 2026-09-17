import { DataSource } from 'typeorm';
import { insertTestCountry } from '../../common/testing/insert-test-country';
import { companyRecruitmentScopeCondition } from './technician-eligibility.sql';

/**
 * **الشركة مش مقفولة على نفسها** (ADR-0086 + تعديل ١، docs/08 §163، طلب مالك 2026-09-17):
 *
 * > «لما الكاستمر يختار شركة، والشركة دي محتاجة عدد ناس كبير… يكون الطلب قادر يدعو أي حد سواء
 * > من جوا الشركة أو من برا الشركة… مش عايزين تكون الشركة مغلقة على نفسها.»
 *
 * سياسة التجنيد اتبنت في ADR-0086 وفضلت **بلا أي اختبار** لحد دلوقتي (`grep` على
 * `allows_external_recruitment` في الـspecs كان بيرجّع صفر)، ومن غير واجهة أدمن كمان — يعني
 * مكانش فيه دليل إنها بتشتغل ولا طريقة تشغّلها. الاختبار ده بيشغّل **نفس** الـfragment اللي
 * `OrderTeamService.listRecruitCandidates()` بيحقنه، على Postgres حقيقي، بتلات مرشّحين:
 * عضو في شركة الطلب، فني مستقل، وفني في شركة تانية.
 */
describe('نطاق تجنيد طاقم الشركة — حي (docs/08 §163)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    company: '',
    otherCompany: '',
    ownerUser: '',
    ownerProfile: '',
    insiderUser: '',
    insiderProfile: '',
    outsiderUser: '',
    outsiderProfile: '',
    rivalOwnerUser: '',
    rivalUser: '',
    rivalProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    companyOrder: '',
    soloOrder: '',
  };

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  /**
   * بتشغّل الشرط الحقيقي على كل الفنيين بتوع الاختبار وبترجّع اللي عدّوا.
   *
   * نفس شكل الـjoin اللي في الخدمة بالحرف (`LEFT JOIN technician_companies order_company ON
   * order_company.id = o.assigned_company_id`) — القيمة كلها في إن الاختبار يمتحن نفس النص.
   */
  async function allowedCandidates(orderId: string): Promise<string[]> {
    const rows = await q<{ id: string }[]>(
      `SELECT tp.id
         FROM technician_profiles tp
         JOIN orders o ON o.id = $1
         LEFT JOIN technician_companies order_company ON order_company.id = o.assigned_company_id
        WHERE tp.id = ANY($2::uuid[])
          AND ${companyRecruitmentScopeCondition({
            candidateCompanyIdExpr: 'tp.company_id',
            orderCompanyIdExpr: 'o.assigned_company_id',
            allowsExternalExpr: 'order_company.allows_external_recruitment',
          })}`,
      [orderId, [ids.insiderProfile, ids.outsiderProfile, ids.rivalProfile]],
    );
    return rows.map((r) => r.id).sort();
  }

  const label = (technicianId: string): string =>
    technicianId === ids.insiderProfile
      ? 'عضو الشركة'
      : technicianId === ids.outsiderProfile
        ? 'فني مستقل'
        : 'فني شركة تانية';

  const labelled = async (orderId: string): Promise<string[]> => (await allowedCandidates(orderId)).map(label).sort();

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();

    const country = await insertTestCountry(q, { nameAr: `دولة CRS ${runId}`, nameEn: `CRS Country ${runId}` });
    ids.country = country.id;
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة CRS ${runId}`, `CRS City ${runId}`, `crs-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق CRS ${runId}`, `CRS Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة CRS ${runId}`, `CRS Category ${runId}`, `crs-cat-${runId}`],
    );
    ids.category = category.id;
    const [svc] = await q<{ id: string }[]>(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
      [category.id, `خدمة CRS ${runId}`, `crs-svc-${runId}`],
    );
    ids.service = svc.id;

    let seq = 0;
    const mkUser = async (labelAr: string): Promise<string> => {
      const [user] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
        [`+2017${runId}${seq++}`.slice(0, 15), `${labelAr} ${runId}`],
      );
      return user.id;
    };
    const mkTechnician = async (userId: string, companyId: string | null): Promise<string> => {
      const [tp] = await q<{ id: string }[]>(
        `INSERT INTO technician_profiles (user_id, technician_code, verification_status, company_id)
         VALUES ($1,$2,'approved',$3) RETURNING id`,
        [userId, `CRS${seq}-${runId}`.slice(0, 20), companyId],
      );
      return tp.id;
    };

    ids.ownerUser = await mkUser('مالك الشركة');
    const [company] = await q<{ id: string }[]>(
      `INSERT INTO technician_companies (owner_user_id, name) VALUES ($1,$2) RETURNING id`,
      [ids.ownerUser, `شركة CRS ${runId}`],
    );
    ids.company = company.id;
    ids.ownerProfile = await mkTechnician(ids.ownerUser, ids.company);

    ids.rivalOwnerUser = await mkUser('مالك شركة تانية');
    const [otherCompany] = await q<{ id: string }[]>(
      `INSERT INTO technician_companies (owner_user_id, name) VALUES ($1,$2) RETURNING id`,
      [ids.rivalOwnerUser, `شركة CRS تانية ${runId}`],
    );
    ids.otherCompany = otherCompany.id;

    ids.insiderUser = await mkUser('عضو الشركة');
    ids.insiderProfile = await mkTechnician(ids.insiderUser, ids.company);
    ids.outsiderUser = await mkUser('فني مستقل');
    ids.outsiderProfile = await mkTechnician(ids.outsiderUser, null);
    ids.rivalUser = await mkUser('فني شركة تانية');
    ids.rivalProfile = await mkTechnician(ids.rivalUser, ids.otherCompany);

    const [customerUser] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2016${runId}`.slice(0, 15), `عميل CRS ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customer] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [ids.customerUser],
    );
    ids.customerProfile = customer.id;
    const [address] = await q<{ id: string }[]>(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع CRS ${runId}`],
    );
    ids.address = address.id;

    const makeOrder = async (companyId: string | null, suffix: string): Promise<string> => {
      const [order] = await q<{ id: string }[]>(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id, address_id,
                             service_zone_id, order_status, payment_status, total_amount_cents,
                             platform_commission_cents, technician_earning_cents, booking_mode, placed_at,
                             assigned_company_id, worker_pool_cents, calculation_algorithm_version)
         VALUES (20, $1, $2, $3, $4, $5, $6, 'accepted', 'unpaid', 0, 0, 0, 'team', now(), $7, 0, 'v2')
         RETURNING id`,
        [
          `CRS-${runId}-${suffix}`.slice(0, 24),
          ids.customerProfile,
          ids.ownerProfile,
          ids.service,
          ids.address,
          ids.zone,
          companyId,
        ],
      );
      return order.id;
    };
    ids.companyOrder = await makeOrder(ids.company, 'co');
    ids.soloOrder = await makeOrder(null, 'solo');
  });

  afterAll(async () => {
    await q(`DELETE FROM orders WHERE id = ANY($1)`, [[ids.companyOrder, ids.soloOrder]]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [
      [ids.ownerProfile, ids.insiderProfile, ids.outsiderProfile, ids.rivalProfile],
    ]);
    await q(`DELETE FROM technician_companies WHERE id = ANY($1)`, [[ids.company, ids.otherCompany]]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [
      [ids.ownerUser, ids.rivalOwnerUser, ids.insiderUser, ids.outsiderUser, ids.rivalUser, ids.customerUser],
    ]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await dataSource.destroy();
  });

  it('**الافتراضي مفتوح**: شركة جديدة تقدر تدعو من برّها — دي نقطة الطلب كلها', async () => {
    // مافيش أي UPDATE هنا عن قصد: الشركة اتعملت بالافتراضي بتاع القاعدة (migration 0353).
    const [row] = await q<{ allows_external_recruitment: boolean }[]>(
      `SELECT allows_external_recruitment FROM technician_companies WHERE id = $1`,
      [ids.company],
    );
    expect(row.allows_external_recruitment).toBe(true);
    expect(await labelled(ids.companyOrder)).toEqual(['فني شركة تانية', 'عضو الشركة', 'فني مستقل'].sort());
  });

  it('الأدمن يقفلها ⇒ أعضاء الشركة بس، والباقي بيختفي', async () => {
    await q(`UPDATE technician_companies SET allows_external_recruitment = false WHERE id = $1`, [ids.company]);
    expect(await labelled(ids.companyOrder)).toEqual(['عضو الشركة']);
  });

  it('**طلب مش بتاع شركة مايتأثرش بالقفل** (ADR-0086 بند ٩) — الفني على طلبه الخاص مستقل', async () => {
    // الشركة لسه مقفولة من الاختبار اللي فوق، والطلب ده `assigned_company_id = NULL`.
    expect(await labelled(ids.soloOrder)).toEqual(['فني شركة تانية', 'عضو الشركة', 'فني مستقل'].sort());
  });

  it('فتحها تاني بيرجّع الكل — القرار قابل للعكس في الاتجاهين', async () => {
    await q(`UPDATE technician_companies SET allows_external_recruitment = true WHERE id = $1`, [ids.company]);
    expect(await labelled(ids.companyOrder)).toHaveLength(3);
  });

  it('عضوية الشركة بتتقاس على **شركة الطلب** مش شركة القائد (docs/08 §163)', async () => {
    // القائد هنا عضو في الشركة، فالمقياسين بيتطابقوا. الحالة الفارقة: طلب شركة وقائده من برّها —
    // `COALESCE(o.assigned_company_id, $leaderCompany)` بيخلي البادج للشركة صاحبة الطلب.
    const [row] = await q<{ order_company: boolean; leader_company: boolean }[]>(
      `SELECT (tp.company_id = o.assigned_company_id) AS order_company,
              (tp.company_id = $3::uuid) AS leader_company
         FROM technician_profiles tp JOIN orders o ON o.id = $1
        WHERE tp.id = $2`,
      [ids.companyOrder, ids.insiderProfile, ids.otherCompany],
    );
    expect(row.order_company).toBe(true);
    expect(row.leader_company).toBe(false);
  });
});
