import { DataSource } from 'typeorm';
import { TechnicianProgressionCalculationService } from './technician-progression-calculation.service';

/**
 * **الخصم اللي المنصّة موّلته مايرجّعش الفني لورا في مساره الوظيفي** (ADR-0038، تدقيق النظام).
 *
 * `orders.platform_commission_cents` بيطلع **سالب** بتصميم لما خصم كبير يخلّي اللي العميل دفعه
 * أقل من مستحق الفني — «العميل يستفيد من الخصم، المنصة تتحمل تكلفته، والفني ياخد مستحقه كامل»
 * (نص المالك، ADR-0038).
 *
 * البَقّة اللي الاختبار ده بيقفلها: بوابة الترقية `min_platform_revenue_cents` كانت بتجمع القيم
 * دي **بإشارتها**، فطلب خسران كان **بيخصم** من عدّاد ترقية الفني. يعني الفني بيترجّع لورا بسبب
 * حملة تسويق **المنصّة** هي اللي قررتها — نفس خطأ «الفني بيموّل حملة المنصة من جيبه» اللي
 * ADR-0038 قفله في مسار الفلوس، لكنه فضل مفتوح في مسار الترقية.
 */
describe('تقدّم الترقية — الخصم اللي المنصّة موّلته مايخصمش من رصيد الفني', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechnicianProgressionCalculationService;
  const runId = Date.now().toString(36);
  const ids = { user: '', profile: '', customerProfile: '', address: '', service: '', category: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** طلب مكتمل بعمولة منصّة محدّدة — موجبة (ربح) أو سالبة (المنصّة اتحمّلت الخصم). */
  async function completedOrder(label: string, totalCents: number, earningCents: number, commissionCents: number) {
    await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, order_status,
                           total_amount_cents, technician_earning_cents, platform_commission_cents, work_completed_at)
       VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8, now())`,
      [`PRG-${runId}-${label}`.slice(0, 24), ids.customerProfile, ids.profile, ids.service, ids.address,
       totalCents, earningCents, commissionCents],
    );
  }

  const platformRevenue = async (): Promise<number> => {
    const metrics = await service.getRawMetrics(ids.profile, ids.user, new Date(), new Date(), 1);
    return metrics.platformRevenueCents;
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    service = new TechnicianProgressionCalculationService(dataSource);

    const [u] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2017${runId}`.slice(0, 14), `فني ترقية ${runId}`]);
    ids.user = u.id;
    const [p] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,'new','approved') RETURNING id`, [ids.user, `PRG${runId}`.slice(0, 20)]);
    ids.profile = p.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.user]);
    ids.customerProfile = cp.id;
    const [a] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.user, `ش ترقية ${runId}`]);
    ids.address = a.id;
    const [c] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ترقية ${runId}`, `Prg Cat ${runId}`, `prg-cat-${runId}`]);
    ids.category = c.id;
    const [s] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة ترقية ${runId}`, `prg-svc-${runId}`]);
    ids.service = s.id;
  });

  afterEach(async () => {
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`PRG-${runId}-%`]);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`PRG-${runId}-%`]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.profile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('خط الأساس — طلب رابح لوحده بيتحسب بالكامل', async () => {
    await completedOrder('pos', 10000, 8000, 2000);
    expect(await platformRevenue()).toBe(2000);
  });

  it('**البَقّة**: طلب خسران (خصم المنصّة موّلته) ما بيخصمش من رصيد الطلب الرابح', async () => {
    await completedOrder('pos', 10000, 8000, 2000);
    // العميل دفع ٧٠ ج بكوبون، والفني أخد مستحقه كامل ٨٠ ج ⇒ المنصّة خسرت ١٠ ج على الطلب ده.
    await completedOrder('neg', 7000, 8000, -1000);

    // قبل الإصلاح كان بيرجّع 1000 (2000 − 1000) — نُص تقدّم الفني اتمسح.
    expect(await platformRevenue()).toBe(2000);
  });

  it('طلب خسران لوحده بيتحسب صفر — المنصّة مابتحسبش إيرادًا ما استلمتهوش، والفني مابيترجّعش لورا', async () => {
    await completedOrder('neg', 7000, 8000, -1000);
    expect(await platformRevenue()).toBe(0);
  });

  it('القصّ لكل طلب مش على المجموع — طلبان خسرانان مايبلعوش ربح طلب تالت', async () => {
    await completedOrder('n1', 7000, 8000, -1000);
    await completedOrder('n2', 7000, 8000, -1500);
    await completedOrder('p1', 10000, 8000, 2000);
    // قصّ على المجموع كان هيدّي 0 (2000 − 2500). القصّ لكل طلب بيدّي 2000.
    expect(await platformRevenue()).toBe(2000);
  });
});
