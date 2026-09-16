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

/**
 * **طلب الشركة بيروح لعضو متاح، مش للأعلى ترتيبًا وبس** (ADR-0094، docs/08 §150 بند ٢).
 *
 * بلاغ المالك: «لما الكاستمر بيختار شركة… الطلب بيروح كريكويست، حتى لو فني فاضي».
 *
 * السبب: `firstScheduledCandidate()` كانت بتقرا `members[0]` وبس، وبعدين `classifyCandidate()`
 * بتتفحصه لوحده — فعضو واحد مزنوق كان بيقفل الشركة كلها عن التأكيد التلقائي.
 *
 * **ضابط التجربة جزء أصيل من الاختبار**: من غير الحالة اللي العضو الأعلى فيها فاضي، «الطلب
 * اتأكّد» ممكن يعدّي لأي سبب تاني خالص.
 *
 * **فخّان اتلقطوا في التشغيل الحي ومكتوبين هنا عشان ما يتعادوش**:
 *  1. العضو الاحتياطي لازم يكون حد مستواه المالي **فوق سعر الطلب**. أول نسخة عملته `new`
 *     (حد ٢٠٠ ج.م) والطلب ٢٥٠ — فالعضو كان بيتشال من الأهلية أصلاً والاختبار بيقيس حاجة تانية.
 *  2. تحميل `AppModule` كامل بيعلّق السويت (workers/schedulers مابتتقفلش)، فالخدمة بتتركّب
 *     بإيد زي `company-scoped-dispatch.spec.ts` بالظبط.
 */
describe('طلب الشركة — الاختيار الداخلي بيعدّي العضو المزنوق (ADR-0094)', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let matching: MatchingService;

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids: Record<string, string> = {};
  const users: string[] = [];
  const orders: string[] = [];
  let seq = 0;

  const q = <T = Record<string, string>>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();
    matching = new MatchingService(
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
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `City ${runId}`, `city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق ${runId}`, `Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ${runId}`, `Cat ${runId}`, `cat-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,commission_percentage,
                             warranty_days,estimated_duration_minutes,requires_start_time_only,allows_emergency)
       VALUES ($1,$2,$3,'formula',25000,20,0,90,false,false) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc-${runId}`],
    );
    ids.service = service.id;
  });

  afterAll(async () => {
    if (orders.length) {
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orders]);
    }
    if (users.length) {
      const profiles = `(SELECT id FROM technician_profiles WHERE user_id = ANY($1::uuid[]))`;
      await q(`DELETE FROM technician_zones WHERE technician_id IN ${profiles}`, [users]);
      await q(`DELETE FROM technician_services WHERE technician_id IN ${profiles}`, [users]);
      // `company_exclusive` لازم يتشال **مع** الشركة في نفس الجملة — القيد
      // `chk_technician_profiles_company_exclusive_needs_company` بيرفض عضو حصري بلا شركة.
      await q(
        `UPDATE technician_profiles SET company_id = NULL, company_exclusive = false WHERE user_id = ANY($1::uuid[])`,
        [users],
      );
      await q(`DELETE FROM technician_companies WHERE owner_user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM technician_profiles WHERE user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM addresses WHERE user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM customer_profiles WHERE user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    }
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  const makeUser = async (type: 'technician' | 'customer') => {
    seq += 1;
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3) RETURNING id`,
      [`+2012${runId.slice(0, 6)}${seq}`.slice(0, 15), `${type} ${runId} ${seq}`, type],
    );
    users.push(user.id);
    return user.id as string;
  };

  const makeMember = async (level: string, companyId: string) => {
    const userId = await makeUser('technician');
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
          technician_kind, current_location, company_id, company_exclusive)
       VALUES ($1,$2,$3::technician_level,'approved',true,true,'technician',
               ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,$4,true) RETURNING id`,
      [userId, `CMA${runId.slice(0, 8)}${seq}`.slice(0, 20), level, companyId],
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

  const makeOrder = async (opts: {
    scheduledAt: Date;
    minutes: number;
    technicianId?: string;
    companyId?: string;
    status: string;
  }) => {
    const userId = await makeUser('customer');
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [userId]);
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'ش','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [userId, ids.city],
    );
    seq += 1;
    const [order] = await q(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
         requested_technician_company_id, total_amount_cents, payment_method, commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6::order_status,'individual',$7,$8,$9,$10,25000,'cash',20.00) RETURNING id`,
      [
        profile.id,
        ids.service,
        address.id,
        ids.zone,
        `CMA-${runId}-${seq}`,
        opts.status,
        opts.scheduledAt,
        opts.minutes,
        opts.technicianId ?? null,
        opts.companyId ?? null,
      ],
    );
    orders.push(order.id);
    return order.id as string;
  };

  const runScenario = async (topMemberBusy: boolean) => {
    const ownerId = await makeUser('technician');
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id,name,is_active) VALUES ($1,$2,true) RETURNING id`,
      [ownerId, `شركة ${runId} ${seq}`],
    );
    // بريميوم بيتصدّر الترتيب (وزن أولوية ٣٠ مقابل ١٠ لـverified)، فحتى مع غرامة الحِمل
    // بيفضل الأول — وده بالظبط اللي بيخلّي الاختيار يقع عليه وهو مش فاضي.
    const top = await makeMember('premium', company.id);
    // `verified` مش `new`: حد المستوى `new` ٢٠٠ ج.م والطلب ٢٥٠ (الفخ رقم ١ فوق).
    const spare = await makeMember('verified', company.id);

    const scheduledAt = new Date(Date.now() + 6 * 86_400_000);
    scheduledAt.setUTCHours(9, 0, 0, 0);
    if (topMemberBusy) {
      // ٥ ساعات من سقف ١٢ — تحت السقف (فالعضو لسه **مؤهّل**) وفوق «خفيف» بوضوح.
      await makeOrder({ scheduledAt, minutes: 300, technicianId: top, status: 'accepted' });
    }
    const orderId = await makeOrder({
      scheduledAt,
      minutes: 90,
      companyId: company.id,
      status: 'searching_technician',
    });
    await matching.dispatchOrAutoConfirm(orderId);
    const [row] = await q<{ order_status: string; technician_id: string | null }>(
      `SELECT order_status, technician_id FROM orders WHERE id = $1`,
      [orderId],
    );
    return {
      status: row.order_status,
      assignedTo: row.technician_id === top ? 'top' : row.technician_id === spare ? 'spare' : row.technician_id,
    };
  };

  it('ضابط: الأعلى ترتيبًا فاضي ⇒ الطلب بيتأكّد له', async () => {
    expect(await runScenario(false)).toEqual({ status: 'accepted', assignedTo: 'top' });
  });

  it('الأعلى ترتيبًا مشغول والتاني فاضي ⇒ الطلب بيتأكّد **للتاني**، مش بيروح لجولات عروض', async () => {
    expect(await runScenario(true)).toEqual({ status: 'accepted', assignedTo: 'spare' });
  });
});
