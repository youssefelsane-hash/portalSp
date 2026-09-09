import { DataSource } from 'typeorm';
import { AdminOrdersService } from './admin-orders.service';
import { Order } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';

/**
 * **بلاغ مالك حقيقي (2026-09-06، `req_9ebba756`)**: صفحة الطلب في الأدمن كانت بترجّع 500
 * «V2 platform commission cannot exceed the final order total».
 *
 * السبب: في فلو التقييم الطلب بيتعمل بإجمالي = رسم التقييم (أو صفر) لأن السعر النهائي لسه
 * ما اتحددش، بينما لقطة العمولة الثابتة هي عمولة الشغلانة **كاملة**. معاينة الحصص كانت
 * بتنادي `calculateEarningsV2()` بالإجمالي المؤقت، والحاسبة بترمي صراحةً لما العمولة تعدّي
 * الإجمالي — وده صح كحارس تسوية، وغلط تمامًا كمعاينة قراءة.
 *
 * الاختبار بينادي `listEarningShares()` الحقيقية على طلب حقيقي في قاعدة بيانات حقيقية.
 */
describe('معاينة حصص المستحقات لطلب لسه سعره ما اتحددش (V2)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let service: AdminOrdersService;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    category: '', service: '', tech: '', techUser: '',
    customer: '', customerProfile: '', address: '', zone: '', city: '',
    unpricedOrder: '', pricedOrder: '',
  };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  /**
   * `priceStatus` هو علامة «السعر لسه ما اتحددش» في نموذج البيانات الحالي
   * (`platform_commission_cents_snapshot` بقى بيتكتب null دايمًا من `order-creation.service`،
   * فما بقاش يوصف الحالة دي). طلب في `waiting_assessment` إجماليه = رسم المعاينة بس.
   */
  const makeOrder = async (
    totalCents: number,
    commissionCents: number,
    priceStatus: 'confirmed' | 'waiting_assessment' = 'confirmed',
  ): Promise<string> => {
    const [o] = await q(
      `INSERT INTO orders (commission_rate_applied,order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
                           order_status, total_amount_cents, settlement_policy_version,
                           platform_commission_cents_snapshot, price_status)
       VALUES (20,$1,$2,$3,$4,$5,$6,'accepted',$7,2,$8,$9) RETURNING id`,
      [
        `AES-${runId}-${totalCents}`,
        ids.customerProfile, ids.service, ids.address, ids.zone, ids.tech, totalCents, commissionCents, priceStatus,
      ],
    );
    return o.id;
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderTeamMember],
    });
    await dataSource.initialize();

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`حصص ${runId}`, `aes ${runId}`, `aes-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, estimated_duration_minutes, pricing_model)
       VALUES ($1,$2,$3,$4,50000,60,'formula') RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc ${runId}`, `aes-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `aes-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `منطقة ${runId}`, `zone ${runId}`],
    );
    ids.zone = zone.id;
    const [cu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2092${runId}`.slice(0, 15), `عميل ${runId}`],
    );
    ids.customer = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customer]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, label, street_name, city_id, location)
       VALUES ($1,'بيت','شارع',$2,ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) RETURNING id`,
      [ids.customer, ids.city],
    );
    ids.address = addr.id;
    const [tu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2091${runId}`.slice(0, 15), `فني ${runId}`],
    );
    ids.techUser = tu.id;
    const [tp] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status)
       VALUES ($1,$2,'approved') RETURNING id`,
      [ids.techUser, `AES-${runId}`],
    );
    ids.tech = tp.id;

    // طلب تقييم: الإجمالي لسه رسم التقييم بس (٥٠ جنيه)، والعمولة الثابتة عمولة الشغلانة كاملة.
    ids.unpricedOrder = await makeOrder(5_000, 12_000, 'waiting_assessment');
    // طلب متسعّر عادي — نفس المسار لازم يفضل شغّال.
    ids.pricedOrder = await makeOrder(50_000, 12_000);

    // نفس الخدمة بتُقرأ من `teamMembers.manager` و`orders`، والباقي مش داخل المسار ده خالص.
    service = new AdminOrdersService(
      dataSource.getRepository(Order),
      undefined as never,
      undefined as never,
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never,
      {
        // لو المسار وصل هنا لطلب غير متسعّر يبقى الحارس اتكسر — الحاسبة الحقيقية بترمي.
        calculateOrder: async () => {
          throw new Error('V2 platform commission cannot exceed the final order total');
        },
      } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const alive = (id: string): string[] => (id ? [id] : []);
    try {
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [[...alive(ids.unpricedOrder), ...alive(ids.pricedOrder)]]);
      await q(`DELETE FROM addresses WHERE id = ANY($1)`, [alive(ids.address)]);
      await q(`DELETE FROM customer_profiles WHERE id = ANY($1)`, [alive(ids.customerProfile)]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [alive(ids.tech)]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[...alive(ids.customer), ...alive(ids.techUser)]]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [alive(ids.service)]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [alive(ids.category)]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [alive(ids.zone)]);
      await q(`DELETE FROM cities WHERE id = ANY($1)`, [alive(ids.city)]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('طلب لسه سعره ما اتحددش: بترجّع فاضية بدل ما تفجّر الصفحة بـ500', async () => {
    await expect(service.listEarningShares(ids.unpricedOrder)).resolves.toEqual([]);
  });

  it('طلب متسعّر: المسار لسه بيوصل للحاسبة (الحارس مابيبلعش الحالات الصح)', async () => {
    await expect(service.listEarningShares(ids.pricedOrder)).rejects.toThrow(
      /platform commission cannot exceed/,
    );
  });
});
