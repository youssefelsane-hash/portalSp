import { DataSource } from 'typeorm';
import { Order } from './entities/order.entity';

// docs/08 §63.ب5 — بلاغ المالك: «الطلبات بتبقى مترتبة بطريقة شبه عشوائية».
//
// الاختبار ده بيثبت السبب الجذري نفسه على Postgres حقيقي (مش على الكود): `placed_at` عمود
// nullable، وPostgres في `ORDER BY ... DESC` بيحط NULL **الأول** افتراضيًا — فطلب من غير
// `placed_at` بيقفز فوق كل القايمة. وبيثبت إن الصيغة الجديدة بتحل ده وبتدي ترتيب حتمي.
describe('ترتيب قايمة الطلبات عند الأدمن (docs/08 §63.ب5)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  const ids: { customerUserId: string; customerId: string; addressId: string; cityId: string; serviceId: string; orderIds: string[] } = {
    customerUserId: '', customerId: '', addressId: '', cityId: '', serviceId: '', orderIds: [],
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order],
    });
    await dataSource.initialize();

    const [country] = await dataSource.query(`SELECT id FROM countries LIMIT 1`);
    const [category] = await dataSource.query(`SELECT id FROM service_categories LIMIT 1`);
    const [city] = await dataSource.query(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ترتيب ${runId}`, `OrdCity${runId}`, `ord-city-${runId}`],
    );
    ids.cityId = city.id;
    const [u] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2081${runId}`.slice(0, 15), `عميل ترتيب ${runId}`],
    );
    ids.customerUserId = u.id;
    const [cp] = await dataSource.query(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [u.id]);
    ids.customerId = cp.id;
    const [a] = await dataSource.query(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [u.id, ids.cityId, 'شارع الترتيب'],
    );
    ids.addressId = a.id;
    const [svc] = await dataSource.query(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'fixed',10000,true) RETURNING id`,
      [category.id, `خدمة ترتيب ${runId}`, `ord-service-${runId}`],
    );
    ids.serviceId = svc.id;

    // ثلاث طلبات: قديم، حديث، وواحد **بلا placed_at** (ده اللي كان بيقفز فوق).
    const seed = async (num: string, placedAt: string | null, createdOffsetHours: number) => {
      const [row] = await dataSource.query(
        `INSERT INTO orders (order_number, customer_id, address_id, service_id, order_status, payment_method,
                             total_amount_cents, placed_at, created_at)
         VALUES ($1,$2,$3,$4,'searching_technician','cash',10000,$5, now() - ($6 || ' hours')::interval)
         RETURNING id`,
        [`ORD-SORT-${runId}-${num}`, ids.customerId, ids.addressId, ids.serviceId, placedAt, String(createdOffsetHours)],
      );
      ids.orderIds.push(row.id);
      return row.id as string;
    };
    // الأقدم طلبًا، الأحدث طلبًا، وواحد بلا placed_at أُنشئ في المنتصف زمنيًا
    await seed('OLD', new Date(Date.now() - 72 * 3600_000).toISOString(), 72);
    await seed('NEW', new Date(Date.now() - 1 * 3600_000).toISOString(), 1);
    await seed('NULL', null, 24);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, p?: unknown[]) => dataSource.query(sql, p);
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`ORD-SORT-${runId}-%`]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerId]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUserId]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.serviceId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('السلوك القديم (placed_at DESC وحده): الطلب اللي بلا placed_at بيقفز فوق القايمة', async () => {
    const rows = await dataSource.query<{ order_number: string }[]>(
      `SELECT order_number FROM orders WHERE order_number LIKE $1 ORDER BY placed_at DESC`,
      [`ORD-SORT-${runId}-%`],
    );
    // ده مش سلوك مرغوب — الاختبار بيوثّق البَقّة عشان ما ترجعش تاني.
    expect(rows[0].order_number).toBe(`ORD-SORT-${runId}-NULL`);
  });

  it('السلوك الجديد: الأحدث فعلاً فوق، واللي بلا placed_at بيترتّب بوقت إنشائه', async () => {
    const rows = await dataSource.query<{ order_number: string }[]>(
      `SELECT order_number FROM orders WHERE order_number LIKE $1
       ORDER BY COALESCE(placed_at, created_at) DESC, id DESC`,
      [`ORD-SORT-${runId}-%`],
    );
    expect(rows.map((r) => r.order_number)).toEqual([
      `ORD-SORT-${runId}-NEW`,   // اتطلب من ساعة
      `ORD-SORT-${runId}-NULL`,  // بلا placed_at، أُنشئ من 24 ساعة
      `ORD-SORT-${runId}-OLD`,   // اتطلب من 72 ساعة
    ]);
  });

  it('الترتيب حتمي: نفس الاستعلام بيدّي نفس النتيجة مع تساوي التوقيتات', async () => {
    await dataSource.query(
      `UPDATE orders SET placed_at = now(), created_at = now() WHERE order_number LIKE $1`,
      [`ORD-SORT-${runId}-%`],
    );
    const run = () =>
      dataSource.query<{ order_number: string }[]>(
        `SELECT order_number FROM orders WHERE order_number LIKE $1
         ORDER BY COALESCE(placed_at, created_at) DESC, id DESC`,
        [`ORD-SORT-${runId}-%`],
      );
    const first = await run();
    const second = await run();
    expect(first.map((r) => r.order_number)).toEqual(second.map((r) => r.order_number));
  });
});
