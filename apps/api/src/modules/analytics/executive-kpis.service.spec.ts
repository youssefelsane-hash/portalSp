import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { ExecutiveKpisService, KpiValue } from './executive-kpis.service';

/**
 * ADR-0081 §1/§2 — لوحة قيادة الشركة.
 *
 * الاختبار ده بيبني **بيانات معروفة بالظبط** (٤ طلبات بأرقام محسوبة بالإيد) وبيتأكد إن كل
 * مقياس بيقول الرقم الصح. أهم اللي بيتغطّى مش الحسابات السهلة، ده:
 *
 * 1. **`null` مش صفر** لما المقياس مالوش معنى — الفرق بين «مفيش إلغاءات» و«مفيش طلبات»،
 *    وبين «اكتساب العميل ببلاش» و«ما دخلناش الإنفاق». صفر هنا كذب.
 * 2. **الأساس الزمني مختلف لكل سؤال**: الاكتمال بتاريخ الاكتمال، الفلوس بتاريخ الدفع،
 *    الطلبات بتاريخ الطلب. طلب اتعمل الشهر اللي فات واتدفع الشهر ده لازم يبان في إيراد
 *    الشهر ده مش في طلباته.
 * 3. **الانضباط بيتحسب على المعروف بس** — الطلب اللي `was_on_time` فيه NULL مايتحسبش متأخر.
 * 4. **الوسيط جنب المتوسط** — طلب واحد استنى ساعات بيرفع المتوسط لوحده.
 */
describe('ExecutiveKpisService (ADR-0081) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: ExecutiveKpisService;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerA: '',
    customerAProfile: '',
    customerB: '',
    customerBProfile: '',
    address: '',
    addressB: '',
    techUser: '',
    techProfile: '',
  };
  const orders: string[] = [];
  const spendIds: string[] = [];

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  /** إعداد القدرة اليومية ثابت في الاختبار عشان الاستغلال يبقى رقم متوقّع. */
  const settings = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

  interface OrderSeed {
    customerProfile: string;
    addressId: string;
    status: string;
    paymentStatus?: string;
    placedAt: string;
    assignedAt?: string | null;
    completedAt?: string | null;
    paidAt?: string | null;
    total?: number;
    commission?: number;
    earning?: number;
    discount?: number;
    onTime?: boolean | null;
    withTechnician?: boolean;
    durationMinutes?: number | null;
    parentOrderId?: string | null;
  }

  /**
   * القيد `chk_orders_percentage_earnings_settlement_balances` (0280) بيفرض على أي طلب مدفوع
   * بسياسة الأرباح الموحدة إن `عمولة + مجمّع العمال = الإجمالي` و`أرباح الفني = مجمّع العمال`.
   * ده ثابت مالي صح، فالبذور هنا بتحترمه بدل ما تتحايل عليه.
   */
  async function makeOrder(seed: OrderSeed): Promise<string> {
    const [order] = await q<{ id: string }[]>(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id, address_id,
                           service_zone_id, order_status, payment_status, total_amount_cents, platform_commission_cents,
                           technician_earning_cents, discount_amount_cents, booking_mode, placed_at, assigned_at,
                           work_completed_at, paid_at, was_on_time, duration_minutes, parent_order_id,
                           worker_pool_cents, calculation_algorithm_version)
       VALUES (20, $1, $2, $3, $4, $5, $6, $7::order_status, $8::order_payment_status, $9, $10, $11, $12, 'individual',
               $13::timestamptz, $14::timestamptz, $15::timestamptz, $16::timestamptz, $17, $18, $19, $11, 'v2')
       RETURNING id`,
      [
        `KPI-${runId}-${orders.length}`.slice(0, 24),
        seed.customerProfile,
        seed.withTechnician === false ? null : ids.techProfile,
        ids.service,
        seed.addressId,
        ids.zone,
        seed.status,
        seed.paymentStatus ?? 'unpaid',
        seed.total ?? 0,
        seed.commission ?? 0,
        seed.earning ?? 0,
        seed.discount ?? 0,
        seed.placedAt,
        seed.assignedAt ?? null,
        seed.completedAt ?? null,
        seed.paidAt ?? null,
        seed.onTime ?? null,
        seed.durationMinutes ?? null,
        seed.parentOrderId ?? null,
      ],
    );
    orders.push(order.id);
    return order.id;
  }

  const kpi = (result: { kpis: KpiValue[] }, key: string): KpiValue => result.kpis.find((k) => k.key === key)!;

  /** نافذة الاختبار: يومين محدّدين في الماضي، بعيد عن أي بيانات تانية في القاعدة. */
  const windowFrom = new Date('2031-03-10T00:00:00Z');
  const windowTo = new Date('2031-03-12T00:00:00Z');

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();
    service = new ExecutiveKpisService(dataSource, settings);

    const [country] = await q<{ id: string }[]>(
      `INSERT INTO countries (name_ar, name_en, iso_code, currency_code, phone_prefix)
       VALUES ($1,$2,$3,'EGP','+20') RETURNING id`,
      [`دولة KPI ${runId}`, `KPI Country ${runId}`, runId.slice(-2).toUpperCase()],
    );
    ids.country = country.id;
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة KPI ${runId}`, `KPI City ${runId}`, `kpi-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق KPI ${runId}`, `KPI Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة KPI ${runId}`, `KPI Category ${runId}`, `kpi-cat-${runId}`],
    );
    ids.category = category.id;
    const [svc] = await q<{ id: string }[]>(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
      [category.id, `خدمة KPI ${runId}`, `kpi-svc-${runId}`],
    );
    ids.service = svc.id;

    const mkCustomer = async (label: string): Promise<{ user: string; profile: string; address: string }> => {
      const [user] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
        [`+20k${label}${runId}`.slice(0, 15), `عميل ${label} ${runId}`],
      );
      const [profile] = await q<{ id: string }[]>(
        `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
        [user.id],
      );
      const [address] = await q<{ id: string }[]>(
        `INSERT INTO addresses (user_id, street_name, location)
         VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
        [user.id, `شارع ${label} ${runId}`],
      );
      return { user: user.id, profile: profile.id, address: address.id };
    };
    const a = await mkCustomer('أ');
    const b = await mkCustomer('ب');
    ids.customerA = a.user;
    ids.customerAProfile = a.profile;
    ids.address = a.address;
    ids.customerB = b.user;
    ids.customerBProfile = b.profile;
    ids.addressB = b.address;

    const [techUser] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+20kt${runId}`.slice(0, 15), `فني KPI ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q<{ id: string }[]>(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status)
       VALUES ($1,$2,'approved') RETURNING id`,
      [techUser.id, `KPI-${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    // ═══ البيانات المعروفة ═══
    // ١) مكتمل، مدفوع، في الميعاد: إجمالي 100000، عمولة 20000، أرباح فني 80000، خصم 5000.
    await makeOrder({
      customerProfile: ids.customerAProfile,
      addressId: ids.address,
      status: 'completed',
      paymentStatus: 'paid',
      placedAt: '2031-03-10T08:00:00Z',
      assignedAt: '2031-03-10T08:10:00Z', // ١٠ دقايق للمطابقة
      completedAt: '2031-03-10T12:00:00Z',
      paidAt: '2031-03-10T12:30:00Z',
      total: 100_000,
      commission: 20_000,
      earning: 80_000,
      discount: 5_000,
      onTime: true,
      durationMinutes: 240,
    });
    // ٢) مكتمل، مدفوع، **متأخر**: إجمالي 50000، عمولة 10000.
    await makeOrder({
      customerProfile: ids.customerAProfile,
      addressId: ids.address,
      status: 'completed',
      paymentStatus: 'paid',
      placedAt: '2031-03-10T09:00:00Z',
      assignedAt: '2031-03-10T09:30:00Z', // ٣٠ دقيقة
      completedAt: '2031-03-11T10:00:00Z',
      paidAt: '2031-03-11T10:30:00Z',
      total: 50_000,
      commission: 10_000,
      earning: 40_000,
      onTime: false,
      durationMinutes: 120,
    });
    // ٣) ملغي — بيدخل في معدّل الإلغاء ومش بيدخل في أي رقم مالي.
    await makeOrder({
      customerProfile: ids.customerBProfile,
      addressId: ids.addressB,
      status: 'cancelled_by_customer',
      placedAt: '2031-03-11T09:00:00Z',
      withTechnician: false,
    });
    // ٤) مكتمل بس **الانضباط مش معروف** (`was_on_time` NULL) — مايتحسبش متأخر.
    await makeOrder({
      customerProfile: ids.customerBProfile,
      addressId: ids.addressB,
      status: 'completed',
      placedAt: '2031-03-11T11:00:00Z',
      assignedAt: '2031-03-11T11:05:00Z',
      completedAt: '2031-03-11T15:00:00Z',
      onTime: null,
      durationMinutes: 60,
    });
  });

  afterAll(async () => {
    await q(`DELETE FROM marketing_spend WHERE id = ANY($1)`, [spendIds]);
    await q(`DELETE FROM orders WHERE id = ANY($1)`, [orders]);
    await q(`DELETE FROM addresses WHERE id = ANY($1)`, [[ids.address, ids.addressB]]);
    await q(`DELETE FROM customer_profiles WHERE id = ANY($1)`, [[ids.customerAProfile, ids.customerBProfile]]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customerA, ids.customerB, ids.techUser]]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await dataSource.destroy();
  });

  describe('الحجم والتكرار', () => {
    it('الطلبات المكتملة بتتعد **بتاريخ الاكتمال** مش بتاريخ الطلب', async () => {
      // تلاتة اكتملوا في النافذة (طلبين مدفوعين + واحد مجهول الانضباط).
      const result = await service.executiveKpis(windowFrom, windowTo);
      expect(kpi(result, 'completed_orders').value).toBe(3);
      expect(kpi(result, 'placed_orders').value).toBe(4);
    });

    it('نافذة بتغطي الطلب بس مش اكتماله بتعد الطلب ومابتعدش الاكتمال', async () => {
      // ٤ طلبات اتعملت، بس واحد بس اللي اكتمل قبل ١٠ مساءً يوم ١٠.
      const result = await service.executiveKpis(windowFrom, new Date('2031-03-10T13:00:00Z'));
      expect(kpi(result, 'placed_orders').value).toBe(2);
      expect(kpi(result, 'completed_orders').value).toBe(1);
    });
  });

  describe('المال — GMV مش الإيراد', () => {
    it('GMV إجمالي المدفوع، والإيراد العمولة بس', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      expect(kpi(result, 'gmv_cents').value).toBe(150_000);
      expect(kpi(result, 'revenue_cents').value).toBe(30_000);
      expect(kpi(result, 'technician_earnings_cents').value).toBe(120_000);
    });

    it('هامش المساهمة = الإيراد ناقص الخصومات (الترويج تكلفة منصة، 0287)', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      expect(kpi(result, 'discounts_cents').value).toBe(5_000);
      expect(kpi(result, 'contribution_margin_cents').value).toBe(25_000);
    });

    it('الأرقام المالية بتتنسب **لتاريخ الدفع** — طلب اتدفع برّه النافذة مايدخلش', async () => {
      const result = await service.executiveKpis(windowFrom, new Date('2031-03-11T00:00:00Z'));
      // الطلب التاني اتدفع يوم ١١، فبرّه النافذة دي.
      expect(kpi(result, 'gmv_cents').value).toBe(100_000);
      expect(kpi(result, 'revenue_cents').value).toBe(20_000);
    });
  });

  describe('المطابقة والإلغاء', () => {
    it('نسبة المطابقة والإلغاء بتتحسبوا على طلبات الفترة', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      // ٣ من ٤ اتعيّنلهم فني (الملغي لأ).
      expect(kpi(result, 'match_rate').value).toBe(75);
      expect(kpi(result, 'match_rate').sample_size).toBe(4);
      expect(kpi(result, 'cancellation_rate').value).toBe(25);
    });

    it('**الوسيط جنب المتوسط** — طلب واحد بطيء بيرفع المتوسط لوحده', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      // أزمنة المطابقة: ١٠، ٣٠، ٥ دقايق ⇒ الوسيط ١٠ دقايق، المتوسط ١٥.
      expect(kpi(result, 'median_time_to_match_seconds').value).toBe(600);
      expect(kpi(result, 'avg_time_to_match_seconds').value).toBe(900);
    });
  });

  describe('الجودة', () => {
    it('**الانضباط بيتحسب على المعروف بس** — الطلب اللي انضباطه NULL مايتحسبش متأخر', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      // من التلاتة المكتملين، اتنين انضباطهم معروف (واحد في الميعاد وواحد متأخر) ⇒ ٥٠٪.
      // لو الـNULL اتحسب متأخر كانت هتبقى ٣٣٪ — رقم أقل من الحقيقة.
      expect(kpi(result, 'on_time_rate').value).toBe(50);
      expect(kpi(result, 'on_time_rate').sample_size).toBe(2);
    });

    it('معدّل الشكاوى وإعادة الشغل على الطلبات المكتملة', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      expect(kpi(result, 'complaint_rate').value).toBe(0);
      expect(kpi(result, 'rework_rate').value).toBe(0);
      expect(kpi(result, 'complaint_rate').sample_size).toBe(3);
    });

    it('زيارة إعادة مربوطة بطلب مكتمل بترفع معدّل إعادة الشغل', async () => {
      const parent = orders[0];
      const revisit = await makeOrder({
        customerProfile: ids.customerAProfile,
        addressId: ids.address,
        status: 'completed',
        placedAt: '2031-03-11T16:00:00Z',
        completedAt: '2031-03-11T18:00:00Z',
        parentOrderId: parent,
      });
      expect(revisit).toBeTruthy();

      const result = await service.executiveKpis(windowFrom, windowTo);
      // بقى ٤ مكتملين وواحد منهم إعادة ⇒ ٢٥٪.
      expect(kpi(result, 'rework_rate').value).toBe(25);

      await q(`DELETE FROM orders WHERE id = $1`, [revisit]);
      orders.splice(orders.indexOf(revisit), 1);
    });
  });

  describe('`null` مش صفر — الفرق اللي بيمنع رقم كاذب', () => {
    it('فترة بلا أي طلبات: النسب `null` بسبب مكتوب، مش أصفار', async () => {
      const empty = await service.executiveKpis(new Date('2031-05-01T00:00:00Z'), new Date('2031-05-02T00:00:00Z'));
      const matchRate = kpi(empty, 'match_rate');
      expect(matchRate.value).toBeNull();
      expect(matchRate.sample_size).toBe(0);
      expect(matchRate.unavailable_reason).toBeTruthy();
      // العدّادات المطلقة بتفضل أصفار — «صفر طلبات» حقيقة، مش غياب بيانات.
      expect(kpi(empty, 'completed_orders').value).toBe(0);
      expect(kpi(empty, 'gmv_cents').value).toBe(0);
    });

    it('**CAC بيرجع `null` لو مفيش إنفاق تسويق مسجّل** — الصفر هنا كذب', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      const cac = kpi(result, 'cac_cents');
      expect(cac.value).toBeNull();
      expect(cac.unavailable_reason).toContain('إنفاق تسويق');
    });

    it('بعد تسجيل الإنفاق: CAC = الإنفاق ÷ العملاء الجداد', async () => {
      const [row] = await q<{ id: string }[]>(
        `INSERT INTO marketing_spend (month, channel, amount_cents) VALUES ('2031-03-01', $1, 200000) RETURNING id`,
        [`قناة-${runId}`.slice(0, 40)],
      );
      spendIds.push(row.id);

      const result = await service.executiveKpis(windowFrom, windowTo);
      const cac = kpi(result, 'cac_cents');
      // عميلين أول طلب ليهم في النافذة دي ⇒ 200000 ÷ 2.
      expect(cac.sample_size).toBe(2);
      expect(cac.value).toBe(100_000);
    });
  });

  describe('العرض', () => {
    it('الاستغلال = دقايق محجوزة ÷ (فنيين معتمدين × قدرة يومية × أيام)', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      const utilization = kpi(result, 'technician_utilization');
      // المقام بيشمل كل الفنيين المعتمدين في القاعدة مش بتوعنا بس، فبنتأكد من الشكل
      // والاتجاه: نسبة موجبة أصغر من ١٠٠٪ ومقامها = الفنيين × ٧٢٠ × يومين.
      expect(utilization.value).not.toBeNull();
      expect(utilization.value!).toBeGreaterThan(0);
      const approved = kpi(result, 'approved_technicians').value!;
      expect(utilization.sample_size).toBe(approved * 720 * 2);
    });

    it('الاستبقاء بيقارن بفترة **بنفس الطول** قبلها', async () => {
      const result = await service.executiveKpis(windowFrom, windowTo);
      const retention = kpi(result, 'technician_retention');
      // مفيش فنيين اشتغلوا في اليومين اللي قبل النافذة ⇒ `null` بسبب مكتوب مش صفر.
      expect(retention.value).toBeNull();
      expect(retention.unavailable_reason).toBeTruthy();
    });
  });
});
