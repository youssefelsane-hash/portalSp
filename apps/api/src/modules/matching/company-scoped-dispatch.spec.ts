import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';
import { isCompanyScopedOrder } from './company-scoped-order';

/**
 * **طلب الشركة مابيخرجش من الشركة** — توضيح المالك (2026-09-15):
 *
 * > «طالما الشركة كسبت، خلاص كده إحنا ركنا بقى الناس اللي برا الشركة كلهم… نخش بقى عادي جوّه
 * >  الشركة، بنختار أي شخص بالأوتوماتيك اللي هو أعلى شخص كفاءة وأقرب شخص.»
 *
 * الترشيح الداخلي جوّه الشركة كان شغّال أصلاً. اللي كان ناقص: لما مايكونش في الشركة حد متاح،
 * جولة التوزيع كانت **بتوسّع للمنصة كلها** — فشغلانة شركة كانت بتتسلّم لفني من برّه، رغم إن
 * العميل شايف اسم الشركة والسعر اتحسب بمعامل الشركة (ADR-0042).
 *
 * الاختبار حي ضد Postgres حقيقي — نفس فلسفة باقي اختبارات التوزيع (مفيش mocks لاستعلامات SQL).
 */
describe('MatchingService.dispatchNextRound() — طلب الشركة مايتسربش لبرّه', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids: Record<string, string> = {};
  const users: string[] = [];

  // الافتراضي `Record<string, string>` عشان صفوف الزرع (`const [city] = await q(...)`) تتقري
  // بلا توصيف لكل نداء؛ والنداءات اللي ليها شكل محدد بتمرّره صراحةً.
  const q = <T = Record<string, string>>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_k: string, f: number) => f) } as never),
      {
        getNumber: jest.fn(async (_k: string, f: number) => f),
        getString: jest.fn(async (_k: string, f: string) => f),
        getBoolean: jest.fn(async (_k: string, f: boolean) => f),
      } as never,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `City ${runId}`, `city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق ${runId}`, `Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ${runId}`, `Cat ${runId}`, `cat-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage,
                             warranty_days, estimated_duration_minutes, requires_start_time_only)
       VALUES ($1,$2,$3,'formula',50000,20,0,120,false) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc-${runId}`],
    );
    ids.service = service.id;

    let seq = 0;
    const makeTechnician = async (label: string, onDuty: boolean) => {
      seq += 1;
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
        [`+2011${runId.slice(0, 6)}${seq}`.slice(0, 15), `فني ${label} ${runId}`],
      );
      users.push(user.id);
      const [profile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
            technician_kind, current_location)
         VALUES ($1,$2,'premium','approved',$3,$3,'technician',
                 ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `CSD${runId.slice(0, 8)}${seq}`.slice(0, 20), onDuty],
      );
      await q(
        `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
         VALUES ($1,$2,true,'approved')`,
        [profile.id, ids.service],
      );
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
        profile.id,
        ids.zone,
      ]);
      return profile.id as string;
    };

    // عضو الشركة الوحيد. بيتعمل **متاح** عادي، وبعدين بيتشغّل بطلب متعارض تحت — ده السيناريو
    // الحقيقي اللي المالك بيتكلم عنه («الشركة مافيهاش حد فاضي»). `is_on_duty = false` لوحدها
    // **مش** بتشيله من الترشيح (اتأكدنا حيًّا)، فالاعتماد عليها كان هيخلّي الاختبار يقيس لا حاجة.
    ids.member = await makeTechnician('member', true);
    // فني برّه الشركة — **متاح تمامًا**. لو الطلب وصله، يبقى التسريب حصل.
    ids.outsider = await makeTechnician('outsider', true);

    const [companyUser] = await q(
      `SELECT user_id FROM technician_profiles WHERE id = $1`,
      [ids.member],
    );
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
      [companyUser.user_id, `شركة ${runId}`],
    );
    ids.company = company.id;
    await q(`UPDATE technician_profiles SET company_id = $2, company_exclusive = true WHERE id = $1`, [
      ids.member,
      ids.company,
    ]);

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2012${runId.slice(0, 7)}`.slice(0, 15), `عميل ${runId}`],
    );
    users.push(customerUser.id);
    const [customer] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customer = customer.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'شارع','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [customerUser.id, ids.city],
    );
    ids.address = address.id;

    // شغلانة قايمة على عضو الشركة الوحيد، نفس اللحظة — فالشركة فعلاً مفيهاش حد فاضي.
    await q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                           address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, payment_method, duration_minutes)
       VALUES (20,$1,$2,$3,$4,$5,$6,'accepted','pending',50000,0,'cash',720)`,
      [`BSY-${runId.slice(0, 10)}`, ids.customer, ids.member, ids.service, ids.address, ids.zone],
    );

    const [order] = await q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
                           service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, payment_method, duration_minutes,
                           requested_technician_company_id)
       VALUES (20,$1,$2,$3,$4,$5,'searching_technician','pending',50000,0,'cash',120,$6) RETURNING id`,
      [`CSD-${runId.slice(0, 10)}`, ids.customer, ids.service, ids.address, ids.zone, ids.company],
    );
    ids.order = order.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE order_id = $1)`, [ids.order]);
      await q(`DELETE FROM chat_threads WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`BSY-${runId.slice(0, 10)}%`]);
      await q(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1))`, [`BSY-${runId.slice(0, 10)}%`]);
      await q(`DELETE FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`BSY-${runId.slice(0, 10)}%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`BSY-${runId.slice(0, 10)}%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customer]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [[ids.member, ids.outsider]]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [[ids.member, ids.outsider]]);
      // `chk_technician_profiles_company_exclusive_needs_company` بيمنع عضو حصري بلا شركة،
      // فلازم العَلَمين يتفكّوا مع بعض قبل ما الشركة تتحذف.
      await q(`UPDATE technician_profiles SET company_id = NULL, company_exclusive = false WHERE id = $1`, [ids.member]);
      await q(`DELETE FROM technician_companies WHERE id = $1`, [ids.company]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.member, ids.outsider]]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  }, 30000);

  it('القاعدة نفسها: الطلب اللي عليه شركة مطلوبة بيتحسب «طلب شركة»', () => {
    expect(isCompanyScopedOrder({ requestedTechnicianCompanyId: 'x' })).toBe(true);
    expect(isCompanyScopedOrder({ requestedTechnicianCompanyId: null })).toBe(false);
  });

  it('**مفيش عرض بيروح لفني من برّه الشركة** لما الشركة مافيهاش حد متاح', async () => {
    await matchingService.dispatchNextRound(ids.order);

    const rows = await q<{ technician_id: string }>(
      `SELECT technician_id FROM order_assignments WHERE order_id = $1`,
      [ids.order],
    );
    const reached = rows.map((r) => r.technician_id);

    expect(reached).not.toContain(ids.outsider);
    // ومحصلش تعيين للطلب من برّه كمان
    const [order] = await q<{ technician_id: string | null }>(
      `SELECT technician_id FROM orders WHERE id = $1`,
      [ids.order],
    );
    expect(order.technician_id).not.toBe(ids.outsider);
  }, 30000);

  /**
   * **ضابط التجربة**: لازم نثبت إن الفني الخارجي **مؤهّل فعلاً** لو الطلب مش طلب شركة.
   * من غير السطر ده، «مفيش عرض راح لبرّه» ممكن تعدّي لأن مفيش حد مؤهّل أصلاً — يعني الاختبار
   * بيقيس لا حاجة ويدّي طمأنينة كاذبة.
   */
  it('ضابط: نفس الطلب بلا شركة **بيوصل** للفني الخارجي — فالفحص اللي فوق بيقيس حاجة حقيقية', async () => {
    const [clone] = await q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
                           service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, payment_method, duration_minutes)
       VALUES (20,$1,$2,$3,$4,$5,'searching_technician','pending',50000,0,'cash',120) RETURNING id`,
      [`CTL-${runId.slice(0, 10)}`, ids.customer, ids.service, ids.address, ids.zone],
    );
    try {
      await matchingService.dispatchNextRound(clone.id);
      const rows = await q<{ technician_id: string }>(
        `SELECT technician_id FROM order_assignments WHERE order_id = $1`,
        [clone.id],
      );
      expect(rows.map((r) => r.technician_id)).toContain(ids.outsider);
    } finally {
      await q(`DELETE FROM order_assignments WHERE order_id = $1`, [clone.id]);
      await q(`DELETE FROM order_status_history WHERE order_id = $1`, [clone.id]);
      await q(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE order_id = $1)`, [clone.id]);
      await q(`DELETE FROM chat_threads WHERE order_id = $1`, [clone.id]);
      await q(`DELETE FROM orders WHERE id = $1`, [clone.id]);
    }
  }, 30000);

  it('والطلب بيفضل بيدوّر (مش بيتلغي) — دورة التعافي بتعيد المحاولة لما عضو الشركة يفضى', async () => {
    const [order] = await q<{ order_status: string }>(`SELECT order_status FROM orders WHERE id = $1`, [ids.order]);
    expect(order.order_status).toBe('searching_technician');
  }, 30000);
});
