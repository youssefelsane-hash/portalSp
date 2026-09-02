import { DataSource } from 'typeorm';
import { AdminOrdersService } from './admin-orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { toOrderResponseDto } from './dto/order-response.dto';
import { ORDER_STATUSES } from '@baytak/shared-types';

/**
 * §116-C — بلاغ مالك: «عند الأدمن مش ظاهر إن فيه طلبات اتعملت أصلًا».
 *
 * الاختبار ده بينادي **الخدمة الحقيقية** (`AdminOrdersService.list()`) على Postgres حقيقي، مش
 * SQL خام مكتوب في السبيك. الفرق مهم: البَقّة اللي بيدوّر عليها ممكن تكون في بناء الاستعلام
 * نفسه (TypeORM)، مش في نص الـSQL اللي إحنا بنتخيّله.
 *
 * القاعدة اللي بيثبتها: **أي حالة طلب موجودة في enum قاعدة البيانات لازم تظهر في قايمة الأدمن.**
 * أي حالة جديدة تتضاف من غير ما الأدمن يشوفها = طلب حقيقي بفلوس حقيقية مالوش مالك عملياتي.
 */
describe('§116-C — كل حالة طلب لازم تظهر في قايمة الأدمن', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let service: AdminOrdersService;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = { city: '', customerUser: '', customer: '', address: '', service: '', category: '' };

  const q = <T = { id: string }>(sql: string, p?: unknown[]): Promise<T[]> => dataSource.query(sql, p) as Promise<T[]>;

  /** كل قيم enum `order_status` من قاعدة البيانات نفسها — مش قايمة مكتوبة بالإيد ممكن تقدم. */
  let allStatuses: string[] = [];

  /** رقم طلب فريد لكل حالة — بالفهرس مش باسم الحالة (أسماء زي cancelled_by_* بتتصادم لو اتقصّت). */
  const orderNumberFor = (index: number) => `ORD-VIS-${runId}-${String(index).padStart(2, '0')}`;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation],
    });
    await dataSource.initialize();

    service = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      {} as never, {} as never, { emit: () => true } as never, { record: async () => undefined } as never,
      {} as never, {} as never,
      { getNumber: async (_k: string, f: number) => f, getBoolean: async (_k: string, f: boolean) => f } as never,
      {} as never, {} as never,
    );

    const rows = await q<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'order_status' ORDER BY e.enumsortorder`,
    );
    allStatuses = rows.map((r) => r.enumlabel);

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [cat] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة رؤية ${runId}`, `vis ${runId}`, `vis-cat-${runId.toLowerCase()}`,
    ]);
    ids.category = cat.id;
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة رؤية ${runId}`, `VisCity${runId}`, `vis-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [u] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2088${runId}`.slice(0, 15), `عميل رؤية ${runId}`,
    ]);
    ids.customerUser = u.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [u.id]);
    ids.customer = cp.id;
    const [a] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [u.id, ids.city, `شارع ${runId}`],
    );
    ids.address = a.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'formula',10000,true) RETURNING id`,
      [ids.category, `خدمة رؤية ${runId}`, `vis-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;

    // طلب واحد لكل حالة — كلهم اتعملوا دلوقتي، فالمفروض كلهم في أول صفحة بترتيب «الأحدث».
    for (const [index, status] of allStatuses.entries()) {
      await q(
        `INSERT INTO orders (order_number, customer_id, address_id, service_id, order_status,
                             payment_method, total_amount_cents, placed_at)
         VALUES ($1,$2,$3,$4,$5::order_status,'cash',10000, now())`,
        [orderNumberFor(index), ids.customer, ids.address, ids.service, status],
      );
    }
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`ORD-VIS-${runId}-%`]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customer]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('قايمة الأدمن بلا فلتر بترجّع كل حالة موجودة في enum قاعدة البيانات', async () => {
    const { items } = await service.list({ page: 1, per_page: 100 } as never);
    const mine = items.filter((o) => o.orderNumber.startsWith(`ORD-VIS-${runId}-`));
    const seen = new Set(mine.map((o) => o.orderStatus as string));
    const missing = allStatuses.filter((s) => !seen.has(s));
    expect(missing).toEqual([]);
  });

  /**
   * الطبقة اللي بعد الخدمة: تحويل الصف لـDTO. الأدمن مابيشوفش الكيان، بيشوف الـDTO — فلو
   * التحويل بيرمي لأي حالة، الطلب بيختفي (أو الطلب كله بيرجع 500 والصفحة بتفضل على آخر نسخة
   * محمّلة، وده بيبان للمالك كأن الطلب «مش موجود»).
   */
  /**
   * **الحارس البنيوي** (ADR-0064 §2) — السبب الجذري للبلاغ مش استعلام غلط، هو إن حالة اتضافت
   * لقاعدة البيانات والباك-إند وفضلت **مجهولة تمامًا** للطبقة اللي الأدمن بيقراها.
   *
   * الاختبار ده بيقارن تلات مصادر لازم يفضلوا متطابقين للأبد:
   *   1. `pg_enum` — الحقيقة في قاعدة البيانات.
   *   2. `OrderStatus` — enum الباك-إند.
   *   3. `ORDER_STATUSES` — القايمة المشتركة اللي الأدمن بيبني منها النصوص والألوان والفلاتر.
   *
   * أي حالة جديدة في واحد بس منهم بتكسر الاختبار هنا، فمستحيل تعدّي بصمت وتخلي طلب حقيقي بفلوس
   * حقيقية غير مرئي لفريق العمليات.
   */
  it('حالات قاعدة البيانات = enum الباك-إند = القايمة المشتركة اللي الأدمن بيقرا منها', () => {
    const backend = Object.values(OrderStatus).sort();
    const shared = [...ORDER_STATUSES].sort();
    const database = [...allStatuses].sort();

    expect({ source: 'backend', missing: database.filter((s) => !backend.includes(s as OrderStatus)) })
      .toEqual({ source: 'backend', missing: [] });
    expect({ source: 'shared-types', missing: database.filter((s) => !shared.includes(s as never)) })
      .toEqual({ source: 'shared-types', missing: [] });
    expect({ source: 'database', extra: shared.filter((s) => !database.includes(s)) })
      .toEqual({ source: 'database', extra: [] });
  });

  it('تحويل الطلب لـDTO بيشتغل لكل حالة، وبيرجّع نفس الحالة الخام', async () => {
    const { items } = await service.list({ page: 1, per_page: 100 } as never);
    const mine = items.filter((o) => o.orderNumber.startsWith(`ORD-VIS-${runId}-`));
    for (const order of mine) {
      const dto = toOrderResponseDto(order);
      expect(dto.order_status).toBe(order.orderStatus);
    }
    expect(mine.length).toBe(allStatuses.length);
  });

  it('الفلترة بحالة بعينها شغّالة لكل حالة — مش بس الحالات القديمة', async () => {
    for (const status of allStatuses) {
      const { items } = await service.list({ page: 1, per_page: 100, order_status: status } as never);
      const mine = items.filter((o) => o.orderNumber === orderNumberFor(allStatuses.indexOf(status)));
      expect({ status, found: mine.length }).toEqual({ status, found: 1 });
    }
  });
});
