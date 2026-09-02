import { DataSource } from 'typeorm';
import { OrderInternalNote } from './entities/order-internal-note.entity';
import { OrderInternalNotesService } from './order-internal-notes.service';

// docs/08 §73 بند 3 — ملاحظات داخلية لمركز الاتصال على الطلب، مش شات/رسالة عادية، والعميل/الفني
// مالهومش أي وصول للجدول ده خالص (endpoint واحد بس، AdminOrdersController).
describe('OrderInternalNotesService — ملاحظات داخلية على الطلب (docs/08 §73 بند 3)', () => {
  let dataSource: DataSource;
  let service: OrderInternalNotesService;
  const runId = Date.now().toString(36);
  const ids = { customer: '', profile: '', admin: '', category: '', service: '', address: '', order: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [OrderInternalNote],
    });
    await dataSource.initialize();
    service = new OrderInternalNotesService(dataSource.getRepository(OrderInternalNote), dataSource);

    const [customer] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2038${runId}`.slice(0, 15),
      `عميل ملاحظات ${runId}`,
    ]);
    ids.customer = customer.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customer]);
    ids.profile = profile.id;
    const [admin] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2039${runId}`.slice(0, 15),
      `أدمن ملاحظات ${runId}`,
    ]);
    ids.admin = admin.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customer, `عنوان ملاحظات ${runId}`],
    );
    ids.address = addr.id;
    const [cat] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ملاحظات ${runId}`,
      `Notes ${runId}`,
      `notes-cat-${runId.toLowerCase()}`,
    ]);
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة ملاحظات ${runId}`, `notes-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, payment_status, total_amount_cents)
       VALUES ($1,$2,$3,$4,'work_completed','unpaid',10000) RETURNING id`,
      [`NOTES-${runId}`.slice(0, 24), ids.profile, ids.service, ids.address],
    );
    ids.order = order.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM order_internal_notes WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customer, ids.admin]]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('add() ثم list() — الملاحظة بترجع مع اسم الكاتب، أحدث الأول', async () => {
    await service.add(ids.order, ids.admin, 'ملاحظة أولى — العميل اتصل يسأل عن الموعد');
    await new Promise((r) => setTimeout(r, 10));
    await service.add(ids.order, ids.admin, 'ملاحظة تانية — أكّدنا الموعد');

    const notes = await service.list(ids.order);
    expect(notes).toHaveLength(2);
    expect(notes[0].note).toBe('ملاحظة تانية — أكّدنا الموعد');
    expect(notes[0].authorFullName).toBe(`أدمن ملاحظات ${runId}`);
    expect(notes[1].note).toBe('ملاحظة أولى — العميل اتصل يسأل عن الموعد');
  });

  it('list() على طلب بلا ملاحظات بيرجّع مصفوفة فاضية', async () => {
    const notes = await service.list('00000000-0000-0000-0000-000000000000');
    expect(notes).toEqual([]);
  });
});
