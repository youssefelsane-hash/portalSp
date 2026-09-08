import { DataSource } from 'typeorm';

/**
 * سياسة رؤية طلبات الشركة (طلب مالك صريح، 2026-09-08):
 *
 * > «كل عضو يشوف الطلبات اللي شارك فيها هو بس، والمالك والمدير يشوفوا كل طلبات الشركة
 * > وتفاصيلها، وأدمن المنصة يشوف كل حاجة.»
 *
 * السلوك قبل كده كان بيخالفها صراحةً: `GET /technician/company/orders` كان بيرجّع **كل**
 * طلبات الشركة لأي عضو (ADR-0033 الأصلي). ده مش تشديد شكلي — صف الطلب فيه اسم العميل
 * والمنطقة والسعر، وعامل في فرع تاني مالوش أي علاقة بالشغلانة ماكانش المفروض يشوفها.
 *
 * الاختبار ده بيشغّل الاستعلام الحقيقي على Postgres حقيقي بتلات أدوار مختلفة على نفس
 * البيانات — الطريقة الوحيدة اللي بتثبت إن الفلتر شغّال فعلاً مش مكتوب وبس.
 */
describe('رؤية طلبات الشركة حسب الدور — حي', () => {
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
    ownerUser: '',
    ownerProfile: '',
    workerAUser: '',
    workerAProfile: '',
    workerBUser: '',
    workerBProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
  };
  const orders: string[] = [];

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;
  const del = async (sql: string, values: (string | undefined)[]): Promise<void> => {
    const clean = values.filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (clean.length > 0) await q(sql, [clean]);
  };

  /**
   * نسخة الاستعلام اللي `TechnicianCompaniesService.queryOrdersForCompany()` بيشغّلها — بنفس
   * شرط المشاركة بالحرف. الاختبار بيقيس **الفلتر**، والفلتر ده هو كل الفرق بين الأدوار.
   */
  async function visibleOrderIds(participantTechnicianId: string | null): Promise<string[]> {
    const rows = await q<{ id: string }[]>(
      `SELECT o.id
         FROM orders o
        WHERE o.assigned_company_id = $1
          AND (
            $2::uuid IS NULL
            OR o.technician_id = $2::uuid
            OR EXISTS (SELECT 1 FROM order_team_members otm
                        WHERE otm.order_id = o.id AND otm.technician_id = $2::uuid)
          )
        ORDER BY o.created_at DESC`,
      [ids.company, participantTechnicianId],
    );
    return rows.map((r) => r.id);
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();

    const [country] = await q<{ id: string }[]>(
      `INSERT INTO countries (name_ar, name_en, iso_code, currency_code, phone_prefix)
       VALUES ($1,$2,$3,'EGP','+20') RETURNING id`,
      [`دولة CV ${runId}`, `CV Country ${runId}`, runId.slice(-2).toUpperCase()],
    );
    ids.country = country.id;
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة CV ${runId}`, `CV City ${runId}`, `cv-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق CV ${runId}`, `CV Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة CV ${runId}`, `CV Category ${runId}`, `cv-cat-${runId}`],
    );
    ids.category = category.id;
    const [svc] = await q<{ id: string }[]>(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
      [category.id, `خدمة CV ${runId}`, `cv-svc-${runId}`],
    );
    ids.service = svc.id;

    let seq = 0;
    const mkUser = async (label: string, type: string): Promise<string> => {
      const [user] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3::user_type) RETURNING id`,
        [`+2018${runId}${seq++}`.slice(0, 15), `${label} ${runId}`, type],
      );
      return user.id;
    };
    const mkTechnician = async (userId: string, role: string): Promise<string> => {
      const [tp] = await q<{ id: string }[]>(
        `INSERT INTO technician_profiles (user_id, technician_code, verification_status, company_id, team_role)
         VALUES ($1,$2,'approved',$3,$4) RETURNING id`,
        [userId, `CV${seq}-${runId}`.slice(0, 20), ids.company, role],
      );
      return tp.id;
    };

    ids.ownerUser = await mkUser('مالك', 'technician');
    const [company] = await q<{ id: string }[]>(
      `INSERT INTO technician_companies (owner_user_id, name) VALUES ($1,$2) RETURNING id`,
      [ids.ownerUser, `شركة CV ${runId}`],
    );
    ids.company = company.id;
    ids.ownerProfile = await mkTechnician(ids.ownerUser, 'owner');

    ids.workerAUser = await mkUser('عامل أ', 'technician');
    ids.workerAProfile = await mkTechnician(ids.workerAUser, 'worker');
    ids.workerBUser = await mkUser('عامل ب', 'technician');
    ids.workerBProfile = await mkTechnician(ids.workerBUser, 'worker');

    ids.customerUser = await mkUser('عميل', 'customer');
    const [customer] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [ids.customerUser],
    );
    ids.customerProfile = customer.id;
    const [address] = await q<{ id: string }[]>(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع CV ${runId}`],
    );
    ids.address = address.id;

    const makeOrder = async (leaderProfileId: string): Promise<string> => {
      const [order] = await q<{ id: string }[]>(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id, address_id,
                             service_zone_id, order_status, payment_status, total_amount_cents,
                             platform_commission_cents, technician_earning_cents, booking_mode, placed_at,
                             assigned_company_id, worker_pool_cents, calculation_algorithm_version)
         VALUES (20, $1, $2, $3, $4, $5, $6, 'accepted', 'unpaid', 0, 0, 0, 'individual', now(), $7, 0, 'v2')
         RETURNING id`,
        [
          `CV-${runId}-${orders.length}`.slice(0, 24),
          ids.customerProfile,
          leaderProfileId,
          ids.service,
          ids.address,
          ids.zone,
          ids.company,
        ],
      );
      orders.push(order.id);
      return order.id;
    };

    // طلب ١: العامل «أ» قائده. طلب ٢: العامل «ب» قائده والعامل «أ» عضو طاقم فيه.
    // طلب ٣: المالك قائده لوحده — مالوش أي علاقة بالعاملين.
    await makeOrder(ids.workerAProfile);
    const second = await makeOrder(ids.workerBProfile);
    await q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id)
       VALUES ($1,$2,'مساعد','assistant',$3)`,
      [second, ids.workerAProfile, ids.workerBProfile],
    );
    await makeOrder(ids.ownerProfile);
  });

  afterAll(async () => {
    await del(`DELETE FROM order_team_members WHERE order_id = ANY($1)`, orders);
    await del(`DELETE FROM orders WHERE id = ANY($1)`, orders);
    await del(`DELETE FROM addresses WHERE id = ANY($1)`, [ids.address]);
    await del(`DELETE FROM customer_profiles WHERE id = ANY($1)`, [ids.customerProfile]);
    await del(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [
      ids.ownerProfile,
      ids.workerAProfile,
      ids.workerBProfile,
    ]);
    await del(`DELETE FROM technician_companies WHERE id = ANY($1)`, [ids.company]);
    await del(`DELETE FROM users WHERE id = ANY($1)`, [
      ids.ownerUser,
      ids.workerAUser,
      ids.workerBUser,
      ids.customerUser,
    ]);
    await del(`DELETE FROM services WHERE id = ANY($1)`, [ids.service]);
    await del(`DELETE FROM service_categories WHERE id = ANY($1)`, [ids.category]);
    await del(`DELETE FROM service_zones WHERE id = ANY($1)`, [ids.zone]);
    await del(`DELETE FROM cities WHERE id = ANY($1)`, [ids.city]);
    await del(`DELETE FROM countries WHERE id = ANY($1)`, [ids.country]);
    await dataSource.destroy();
  });

  it('المالك/المدير بيشوف **كل** طلبات الشركة', async () => {
    const visible = await visibleOrderIds(null);
    expect(visible.sort()).toEqual([...orders].sort());
  });

  it('العامل بيشوف اللي هو قائده **واللي هو عضو طاقم فيه** — وبس', async () => {
    const visible = await visibleOrderIds(ids.workerAProfile);
    expect(visible.sort()).toEqual([orders[0], orders[1]].sort());
  });

  it('طلب زميل مالوش فيه أي مشاركة **مش بيبان له**', async () => {
    const visible = await visibleOrderIds(ids.workerAProfile);
    // الطلب التالت (بتاع المالك) مالوش أي علاقة بالعامل «أ».
    expect(visible).not.toContain(orders[2]);
  });

  it('عامل تاني بيشوف مجموعة مختلفة — الفلتر بالشخص مش بالشركة', async () => {
    const visible = await visibleOrderIds(ids.workerBProfile);
    expect(visible).toEqual([orders[1]]);
  });
});
