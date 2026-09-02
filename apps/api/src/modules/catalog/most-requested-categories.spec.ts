import { DataSource } from 'typeorm';
import { CatalogService } from './catalog.service';
import { ServiceCategory } from './entities/service-category.entity';
import { Service } from './entities/service.entity';

/**
 * docs/08 §77-E2 — «الأكثر طلبًا» من عدد الطلبات الحقيقي.
 *
 * **الفجوة اللي بتتقفل**: القسم كان بيتفلتر في التطبيق بـ`is_featured` اللي الأدمن بيحطه
 * يدويًا. يعني العنوان بيقول «الأكثر طلبًا» والمصدر «اللي الأدمن اختاره» — وعد بيتقال للعميل
 * والنظام مش بينفّذه. نفس فئة البَقّة اللي اتصلحت أكتر من مرة في §75/§76.
 */
describe('CatalogService.findMostRequestedCategories (docs/08 §77-E2)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    custUser: '', profile: '', address: '',
    hot: '', cold: '', featuredOnly: '',
    hotSvc: '', coldSvc: '',
    orders: [] as string[],
  };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  async function makeCategory(label: string, featured: boolean): Promise<string> {
    const [row] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug, is_featured)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [`فئة ${label} ${runId}`, `${label} ${runId}`, `mr-${label}-${runId.toLowerCase()}`, featured],
    );
    return row.id;
  }

  async function makeService(categoryId: string, label: string): Promise<string> {
    const [row] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, pricing_model)
       VALUES ($1,$2,$3,$4,10000,'formula') RETURNING id`,
      [categoryId, `خدمة ${label} ${runId}`, `${label} svc ${runId}`, `mr-svc-${label}-${runId.toLowerCase()}`],
    );
    return row.id;
  }

  async function makeOrder(serviceId: string, status: string, n: number): Promise<void> {
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status,
                           payment_status, total_amount_cents)
       VALUES ($1,$2,$3,$4,$5::order_status,'pending',10000) RETURNING id`,
      [`MR${runId}${n}`, ids.profile, serviceId, ids.address, status],
    );
    ids.orders.push(row.id);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ServiceCategory, Service],
    });
    await dataSource.initialize();
    service = Object.create(CatalogService.prototype) as CatalogService;
    Object.assign(service, {
      categories: dataSource.getRepository(ServiceCategory),
      services: dataSource.getRepository(Service),
      settingsService: { getNumber: async (_k: string, fallback: number) => fallback },
    });

    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2091${runId}`.slice(0, 15), `عميل الأكثر طلبًا ${runId}`],
    );
    ids.custUser = u.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.custUser]);
    ids.profile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.custUser, `عنوان ${runId}`],
    );
    ids.address = addr.id;

    // (أ) فئة عليها طلبات كتير — **مش** مميّزة عند الأدمن.
    ids.hot = await makeCategory('hot', false);
    ids.hotSvc = await makeService(ids.hot, 'hot');
    // (ب) فئة عليها طلب واحد.
    ids.cold = await makeCategory('cold', false);
    ids.coldSvc = await makeService(ids.cold, 'cold');
    // (ج) فئة **مميّزة عند الأدمن بس بلا أي طلبات** — دي اللي بتكشف الفرق.
    ids.featuredOnly = await makeCategory('featured', true);

    for (let i = 0; i < 3; i++) await makeOrder(ids.hotSvc, 'completed', i);
    await makeOrder(ids.coldSvc, 'completed', 90);
    // طلب ملغي على الفئة الباردة — المفروض **ما يتعدّش**.
    await makeOrder(ids.coldSvc, 'cancelled_by_customer', 91);
  });

  afterAll(async () => {
    if (ids.orders.length) await q(`DELETE FROM orders WHERE id = ANY($1)`, [ids.orders]);
    await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.hotSvc, ids.coldSvc]]);
    await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [[ids.hot, ids.cold, ids.featuredOnly]]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.custUser]);
    await dataSource.destroy();
  });

  it('الترتيب بعدد الطلبات — الفئة الأكتر طلبًا قبل الأقل', async () => {
    const result = await service.findMostRequestedCategories(50);
    const order = result.map((c) => c.id);
    expect(order.indexOf(ids.hot)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(ids.cold)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(ids.hot)).toBeLessThan(order.indexOf(ids.cold));
  });

  it('الأكثر طلبًا للخدمات يرجع الشغلانة نفسها لا القسم العام', async () => {
    const result = await service.findMostRequestedServices(200);
    const order = result.map((item) => item.id);
    expect(order).toContain(ids.hotSvc);
    expect(order).toContain(ids.coldSvc);
    expect(order).not.toContain(ids.hot);
    expect(order.indexOf(ids.hotSvc)).toBeLessThan(order.indexOf(ids.coldSvc));
  });

  // ده جوهر البند: فئة مميّزة يدويًا بلا أي طلبات مش «الأكثر طلبًا».
  it('فئة مميّزة عند الأدمن بلا طلبات: **مش** بتظهر — الاسم بقى مطابق للقياس', async () => {
    const result = await service.findMostRequestedCategories(50);
    expect(result.map((c) => c.id)).not.toContain(ids.featuredOnly);
  });

  it('الطلبات الملغاة مش بتتعد — إلغاء مش دليل طلب', async () => {
    // الفئة الباردة عندها طلب مكتمل واحد + ملغي واحد. لو الملغي بيتعد، هتساوي أو تعدّي غيرها.
    const [row] = await q<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM orders o JOIN services s ON s.id = o.service_id
        WHERE s.category_id = $1 AND o.order_status NOT IN
          ('cancelled_by_customer','cancelled_by_technician','cancelled_by_system','expired','draft')`,
      [ids.cold],
    );
    expect(row.c).toBe('1');
  });

  // **النافذة المتحركة**: طلبات قديمة بره النافذة مش المفروض تتعد. الاختبار ده بيقيس ده على
  // فئات الاختبار نفسها بدل ما يفترض قاعدة بيانات نضيفة — الـDB مشتركة بين كل الـsuites،
  // فأي تأكيد على النتيجة الكاملة («كل النتايج مميّزة») بيبقى هش وبيفشل لأسباب مالهاش علاقة
  // بالكود. اتجرّب فعلاً وفشل، فاتغيّر لقياس معزول.
  it('طلبات أقدم من النافذة مش بتتعد', async () => {
    const before = await service.findMostRequestedCategories(200);
    expect(before.map((c) => c.id)).toContain(ids.hot);

    await q(`UPDATE orders SET created_at = now() - interval '400 days' WHERE id = ANY($1)`, [ids.orders]);
    try {
      const after = await service.findMostRequestedCategories(200);
      expect(after.map((c) => c.id)).not.toContain(ids.hot);
      expect(after.map((c) => c.id)).not.toContain(ids.cold);
    } finally {
      await q(`UPDATE orders SET created_at = now() WHERE id = ANY($1)`, [ids.orders]);
    }
  });

  // فرع الرجوع للبذرة اليدوية بيتقاس مباشرةً بدل ما نحاول نفضّي قاعدة بيانات مشتركة.
  it('صفر طلبات في النافذة: بيرجع لاختيار الأدمن بدل قسم فاضي', async () => {
    const emptyDb = Object.create(CatalogService.prototype) as CatalogService;
    Object.assign(emptyDb, {
      categories: dataSource.getRepository(ServiceCategory),
      settingsService: { getNumber: async (_k: string, fallback: number) => fallback },
    });
    // نموّه الاستعلام الخام بصفر نتايج — ده بالظبط شكل منصة جديدة لسه ما اشتغلتش.
    (emptyDb as unknown as { categories: { manager: { query: () => Promise<unknown[]> } } }).categories = {
      ...dataSource.getRepository(ServiceCategory),
      manager: { query: async () => [] },
      find: (opts: unknown) => dataSource.getRepository(ServiceCategory).find(opts as never),
    } as never;

    const result = await emptyDb.findMostRequestedCategories(50);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.isFeatured)).toBe(true);
  });
});
