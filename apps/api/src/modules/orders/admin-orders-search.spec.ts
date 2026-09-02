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
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
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

// docs/08 §73 بند 3 — طلب مالك صريح: مركز الاتصال محتاج يدوّر بتليفون/اسم العميل أو الفني أو
// Payment ID، مش رقم الطلب بس. نفس فلسفة spec فوق (بيانات حقيقية على Postgres حي)، فرع مستقل
// عشان بيانات فني/دفعة إضافية مش لازمة للـ§67 الأصلي.
describe('البحث الموسّع — اسم/تليفون العميل والفني وPayment ID (docs/08 §73 بند 3)', () => {
  let dataSource: DataSource;
  let service: AdminOrdersService;
  const runId = Date.now().toString(36).toUpperCase();
  const ids = {
    customer: '',
    profile: '',
    technicianUser: '',
    technicianProfile: '',
    category: '',
    service: '',
    address: '',
    order: '',
    payment: '',
  };
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
      [`+2036${runId}`.slice(0, 15), `عميل بحث موسّع ${runId}`],
    );
    ids.customer = u.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customer]);
    ids.profile = cp.id;

    const [tu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2037${runId}`.slice(0, 15), `فني بحث موسّع ${runId}`],
    );
    ids.technicianUser = tu.id;
    const [tc] = await q(`SELECT next_technician_code() AS code`);
    const [tp] = await q(`INSERT INTO technician_profiles (user_id, technician_code) VALUES ($1,$2) RETURNING id`, [
      ids.technicianUser,
      tc.code,
    ]);
    ids.technicianProfile = tp.id;

    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customer, `عنوان بحث موسّع ${runId}`],
    );
    ids.address = addr.id;
    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة بحث موسّع ${runId}`, `Wide Search ${runId}`, `wide-search-cat-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة بحث موسّع ${runId}`, `wide-search-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;
    const [o] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, order_status,
                           payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,'work_completed','paid',10000,8000) RETURNING id`,
      [`WSRCH-${runId}`.slice(0, 24), ids.profile, ids.technicianProfile, ids.service, ids.address],
    );
    ids.order = o.id;
    const [payment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_gateway,
                             payment_status, idempotency_key, gateway_reference)
       VALUES ($1,$2,$3,10000,'card','paymob','succeeded',$4,$5) RETURNING id`,
      [`PAY-WSRCH-${runId}`.slice(0, 24), ids.order, ids.profile, `idem-wsrch-${runId}`, `PAYREF-${runId}`],
    );
    ids.payment = payment.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM payments WHERE id = $1`, [ids.payment]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customer, ids.technicianUser]]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('بحث باسم العميل بيرجّع طلباته', async () => {
    const result = await service.list({ search: `عميل بحث موسّع ${runId}` } as never);
    expect(result.items.map((o) => o.id)).toContain(ids.order);
  });

  it('بحث بتليفون العميل بيرجّع طلباته', async () => {
    const result = await service.list({ search: `2036${runId}` } as never);
    expect(result.items.map((o) => o.id)).toContain(ids.order);
  });

  it('بحث باسم الفني بيرجّع الطلب المعيّن له', async () => {
    const result = await service.list({ search: `فني بحث موسّع ${runId}` } as never);
    expect(result.items.map((o) => o.id)).toContain(ids.order);
  });

  it('بحث بتليفون الفني بيرجّع الطلب المعيّن له', async () => {
    const result = await service.list({ search: `2037${runId}` } as never);
    expect(result.items.map((o) => o.id)).toContain(ids.order);
  });

  it('بحث بـPayment ID (gateway_reference) بيرجّع الطلب المرتبط', async () => {
    const result = await service.list({ search: `PAYREF-${runId}` } as never);
    expect(result.items.map((o) => o.id)).toContain(ids.order);
  });
});
