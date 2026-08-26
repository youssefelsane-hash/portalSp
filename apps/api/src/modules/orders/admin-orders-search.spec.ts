import { DataSource } from 'typeorm';
import { AdminOrdersService } from './admin-orders.service';
import { Order } from './entities/order.entity';

/**
 * docs/08 §67 — طلب المالك: «لما أحب أدور على أي طلب قديم أدور عليه وألاقيه، فعايز في المكان
 * بتاع كل الطلبات مكان أدور فيه في السيرش يبقى معايا رقم الطلب وأدور في السيرش ألاقيه بسهولة».
 *
 * قايمة طلبات الأدمن كانت بتفلتر بالحالة/التاريخ/التكرار بس — مفيش أي وسيلة توصل لطلب بعينه
 * غير التقليب صفحة صفحة.
 */
describe('بحث الأدمن برقم الطلب (docs/08 §67)', () => {
  let dataSource: DataSource;
  let service: AdminOrdersService;
  const runId = Date.now().toString(36).toUpperCase();
  const ids = { customer: '', profile: '', category: '', service: '', address: '', orders: [] as string[] };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order],
    });
    await dataSource.initialize();
    service = Object.create(AdminOrdersService.prototype) as AdminOrdersService;
    Object.assign(service, { orders: dataSource.getRepository(Order) });

    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2035${runId}`.slice(0, 15), `عميل بحث ${runId}`],
    );
    ids.customer = u.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customer]);
    ids.profile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customer, `عنوان بحث ${runId}`],
    );
    ids.address = addr.id;
    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة بحث ${runId}`, `Search ${runId}`, `search-cat-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة بحث ${runId}`, `search-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;

    for (const suffix of ['AAA', 'BBB', '50%X']) {
      const [o] = await q(
        `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, payment_status,
                             total_amount_cents, technician_earning_cents)
         VALUES ($1,$2,$3,$4,'work_completed','unpaid',10000,8000) RETURNING id`,
        [`SRCH-${runId}-${suffix}`.slice(0, 24), ids.profile, ids.service, ids.address],
      );
      ids.orders.push(o.id);
    }
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.profile]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customer]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('بحث بالرقم الكامل بيرجّع الطلب ده بس', async () => {
    const result = await service.list({ search: `SRCH-${runId}-AAA` } as never);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].orderNumber).toBe(`SRCH-${runId}-AAA`);
  });

  it('بحث بجزء من الرقم بيرجّع كل اللي مطابق — الأدمن مش لازم يكتبه كامل', async () => {
    const result = await service.list({ search: `SRCH-${runId}` } as never);
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('البحث مش حسّاس لحالة الأحرف', async () => {
    const upper = await service.list({ search: `SRCH-${runId}-BBB` } as never);
    const lower = await service.list({ search: `srch-${runId.toLowerCase()}-bbb` } as never);
    expect(lower.items.map((o) => o.id)).toEqual(upper.items.map((o) => o.id));
  });

  it('`%` اللي المستخدم بيكتبه بيتعامل كنص مش wildcard — وإلا البحث كان هيرجّع كل حاجة', async () => {
    const literal = await service.list({ search: '50%X' } as never);
    expect(literal.items).toHaveLength(1);
    expect(literal.items[0].orderNumber).toContain('50%X');

    // `%` لوحده لو ماكانش متهرّب كان هيطابق كل الطلبات في القاعدة.
    const onlyPercent = await service.list({ search: '%' } as never);
    expect(onlyPercent.items.length).toBeLessThanOrEqual(1);
  });

  it('بحث بلا نتيجة بيرجّع قايمة فاضية مش خطأ', async () => {
    const result = await service.list({ search: 'ORDER-DOES-NOT-EXIST-XYZ' } as never);
    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('من غير بحث القايمة بترجع زي ما هي (صفر تغيير سلوك)', async () => {
    const result = await service.list({ per_page: 5 } as never);
    expect(result.items.length).toBeGreaterThan(0);
  });
});
