import { DataSource } from 'typeorm';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { technicianAvailabilityCondition } from './technician-eligibility.sql';
import { DAILY_CAPACITY_MINUTES_FALLBACK } from './technician-day-capacity.sql';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from '../matching/entities/order-assignment.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';
import { TechnicianAssignmentGuardService } from './technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from './technician-work-opportunities.service';
import { MatchingService } from '../matching/matching.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

/**
 * **الجدولة بالساعة** (ADR-0077، بلاغ مالك حرفي 2026-09-06): «الشغلانة لو ساعة خلاص تبلوك
 * الساعة دي بس. شغلانة والله لو خمس ست ساعات تبلوك خمس ست ساعات».
 *
 * الاختبار بينفّذ نفس شرط التوافر اللي التوزيع والتعيين بيستخدموه على قاعدة بيانات حقيقية.
 */
describe('الجدولة بالساعة مش باليوم (ADR-0077)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let matching: MatchingService;
  const extraTechs: { id: string; userId: string }[] = [];
  const emitted = jest.fn();
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    category: '', service: '', tech: '', techUser: '',
    customer: '', customerProfile: '', address: '', zone: '', city: '',
    orders: [] as string[],
  };
  const CAP = DAILY_CAPACITY_MINUTES_FALLBACK;
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  const dayAfter = (offset: number): string =>
    new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  /** طلب قائم على الفني — ساعة بداية حقيقية + مدة بالدقايق (ناتج محرك التسعير). */
  const makeOrder = async (
    day: string,
    startHour: string,
    opts: { minutes?: number | null; days?: number | null },
  ): Promise<string> => {
    const [o] = await q(
      `INSERT INTO orders (commission_rate_applied,order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
                           order_status, scheduled_at, duration_minutes, estimated_duration_days)
       VALUES (20,$1,$2,$3,$4,$5,$6,'accepted', ($7 || ' ' || $8)::timestamp AT TIME ZONE 'Africa/Cairo', $9, $10)
       RETURNING id`,
      [
        `HRB-${runId}-${ids.orders.length}`,
        ids.customerProfile, ids.service, ids.address, ids.zone, ids.tech,
        day, startHour, opts.minutes ?? null, opts.days ?? null,
      ],
    );
    ids.orders.push(o.id);
    return o.id;
  };

  /**
   * نفس بوابة التوافر اللي `technician-assignment-guard` و`matching` بيستخدموها — بترجّع
   * «الفني ده يقدر ياخد شغلانة بالمواصفات دي؟».
   */
  /**
   * لحظة البداية بتوقيت القاهرة الحقيقي — **مش** بأوفست ثابت. مصر بتطبّق توقيت صيفي، فكتابة
   * `+02:00` في نص الاختبار بتزحلق الموعد ساعة كاملة في نص السنة وتخلي الاختبار يكدب.
   */
  const cairoMoment = async (day: string, startHour: string): Promise<Date> => {
    const [row] = await q<{ at: Date }>(`SELECT ($1 || ' ' || $2)::timestamp AT TIME ZONE 'Africa/Cairo' AS at`, [day, startHour]);
    return row.at;
  };

  const isAvailable = async (
    day: string,
    startHour: string,
    minutes: number,
    days: number | null = null,
  ): Promise<boolean> => {
    const [row] = await q<{ available: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM technician_profiles tp WHERE tp.id = $1
         ${technicianAvailabilityCondition({
           technicianIdExpr: 'tp.id',
           scheduledAtParam: '$2',
           excludeOrderIdParam: 'NULL',
           activeStatusesParam: '$3',
           engagedStatusesParam: '$4',
           isEmergencyParam: '$5',
           serviceDurationExpr: '$6::int',
           preciseDurationHoursExpr: '$6::numeric / 60.0',
           candidateLoad: {
             estimatedDurationDaysExpr: '$7::numeric',
             durationMinutesExpr: '$6::int',
             serviceDefaultMinutesExpr: 'NULL',
           },
           dailyCapacityMinutesParam: '$8',
         })}
       ) AS available`,
      [
        ids.tech,
        await cairoMoment(day, startHour),
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        minutes,
        days,
        CAP,
      ],
    );
    return row.available;
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`ساعة ${runId}`, `hr ${runId}`, `hr-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, estimated_duration_minutes,
                             pricing_model, requires_start_time_only)
       VALUES ($1,$2,$3,$4,10000,60,'formula',true) RETURNING id`,
      [ids.category, `تنظيف بالساعة ${runId}`, `hourly ${runId}`, `hourly-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `hr-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `منطقة ${runId}`, `zone ${runId}`],
    );
    ids.zone = zone.id;
    const [cu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2096${runId}`.slice(0, 15), `عميل ${runId}`],
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
    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2095${runId}`.slice(0, 15), `فني ${runId}`],
    );
    ids.techUser = u.id;
    const [p] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, current_location)
       VALUES ($1,$2,'approved', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) RETURNING id`,
      [ids.techUser, `HRB-${runId}`],
    );
    ids.tech = p.id;
    const settings = {
      getNumber: async (_key: string, fallback: number) => fallback,
      getString: async (_key: string, fallback: string) => fallback,
      getBoolean: async (_key: string, fallback: boolean) => fallback,
    };
    matching = new MatchingService(
      dataSource.getRepository(OrderAssignment), dataSource.getRepository(Order), dataSource,
      new TechniciansService(dataSource.getRepository(TechnicianProfile), {} as never, {} as never,
        {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never),
      new TechnicianAssignmentGuardService(settings as never), settings as never,
      { emit: emitted } as never, { add: async () => undefined } as never,
      new TechnicianWorkOpportunitiesService(dataSource), levelPremiumServiceStub(),
    );
    for (let i = 0; i < 4; i++) {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type)
        VALUES ($1,$2,'technician') RETURNING id`, [`+2094${runId}${i}`, `request ${runId} ${i}`]);
      const [tech] = await q(`INSERT INTO technician_profiles (user_id, technician_code, verification_status, current_location)
        VALUES ($1,$2,'approved',ST_SetSRID(ST_MakePoint(31.2357,30.0444),4326)::geography) RETURNING id`,
      [user.id, `REQ-${runId}-${i}`]);
      extraTechs.push({ id: tech.id, userId: user.id });
    }
    for (const techId of [ids.tech, ...extraTechs.map(t => t.id)]) {
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [techId, ids.service]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [techId, ids.zone]);
    }
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [ids.orders]);
      const techIds = [ids.tech, ...extraTechs.map(t => t.id)];
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [techIds]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [techIds]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [extraTechs.map(t => t.id)]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [extraTechs.map(t => t.userId)]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.tech]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customer, ids.techUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  // ===== بلاغ المالك بالحرف =====
  it('الطلب الثاني المختار يدويًا يظهر كطلب عادي، والمشاهدة وإعادة المحاولة لا تستبدل الفني', async () => {
    const day = dayAfter(70);
    await makeOrder(day, '09:00', { minutes: 60, days: 1 });
    const request = await makeOrder(day, '15:00', { minutes: 60, days: 1 });
    await q(`UPDATE orders SET order_status = 'searching_technician', technician_id = NULL,
      requested_technician_id = $2, provider_lock_source = 'post_quote_selection' WHERE id = $1`, [request, ids.tech]);
    expect((await matching.dispatchOrAutoConfirm(request)).dispatched).toBe(1);
    const visible = await matching.listAvailableForTechnician(ids.techUser);
    expect(visible.some(o => o.order_id === request)).toBe(true);
    await q(`UPDATE order_assignments SET expires_at = now() - interval '1 hour' WHERE order_id = $1`, [request]);
    await matching.dispatchOrAutoConfirm(request);
    const offers = await q<{ technician_id: string; assignment_status: string }>(
      `SELECT technician_id, assignment_status FROM order_assignments WHERE order_id = $1`, [request]);
    expect(offers).toEqual([{ technician_id: ids.tech, assignment_status: 'viewed' }]);
    expect(await q(`SELECT id FROM technician_work_opportunities WHERE order_id = $1`, [request])).toHaveLength(0);
    const accepted = await matching.accept(ids.techUser, request);
    expect(accepted.technicianId).toBe(ids.tech);
    expect((await matching.listAvailableForTechnician(ids.techUser)).some(o => o.order_id === request)).toBe(false);
  });

  it('المطابقة التلقائية ترسل أربعة طلبات متوازية، والقبول المتزامن له فائز واحد', async () => {
    const day = dayAfter(71);
    for (const tech of [ids.tech, ...extraTechs.map(t => t.id)]) {
      const busy = await makeOrder(day, '09:00', { minutes: 60, days: 1 });
      await q(`UPDATE orders SET technician_id = $2 WHERE id = $1`, [busy, tech]);
    }
    const request = await makeOrder(day, '15:00', { minutes: 60, days: 1 });
    await q(`UPDATE orders SET order_status='searching_technician', technician_id=NULL WHERE id=$1`, [request]);
    expect((await matching.dispatchOrAutoConfirm(request)).dispatched).toBe(4);
    const offers = await q<{ user_id: string }>(`SELECT tp.user_id FROM order_assignments a
      JOIN technician_profiles tp ON tp.id=a.technician_id WHERE a.order_id=$1`, [request]);
    expect(offers).toHaveLength(4);
    await q(`UPDATE orders SET order_status='completed' WHERE id=ANY($1) AND id <> $2 AND scheduled_at::date=$3::date`,
      [ids.orders, request, day]);
    await matching.dispatchOrAutoConfirm(request);
    expect((await dataSource.getRepository(Order).findOneByOrFail({ id: request })).orderStatus).toBe('searching_technician');
    const outcomes = await Promise.allSettled(offers.slice(0, 2).map(o => matching.accept(o.user_id, request)));
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);
    const states = await q<{ assignment_status: string }>(`SELECT assignment_status FROM order_assignments WHERE order_id=$1`, [request]);
    expect(states.filter(s => s.assignment_status === 'accepted')).toHaveLength(1);
    expect(states.filter(s => ['sent', 'viewed'].includes(s.assignment_status))).toHaveLength(0);
  });

  it('الفني الفاضي في الموعد البعيد يفضل يتأكد تلقائيًا', async () => {
    const request = await makeOrder(dayAfter(72), '15:00', { minutes: 60, days: 1 });
    await q(`UPDATE orders SET order_status='searching_technician', technician_id=NULL, requested_technician_id=$2 WHERE id=$1`, [request, ids.tech]);
    await matching.dispatchOrAutoConfirm(request);
    expect((await dataSource.getRepository(Order).findOneByOrFail({ id: request })).orderStatus).toBe('accepted');
  });

  it('ساعة الصبح ما بتمنعش ساعة تانية الساعة 3 العصر — والمحرك حاطط estimated_duration_days=1', async () => {
    const day = dayAfter(30);
    await makeOrder(day, '09:00', { minutes: 60, days: 1 });
    expect(await isAvailable(day, '15:00', 60, 1)).toBe(true);
  });

  it('نفس الحالة من غير تقدير أيام — لازم تعدّي برضه', async () => {
    const day = dayAfter(31);
    await makeOrder(day, '09:00', { minutes: 60, days: null });
    expect(await isAvailable(day, '15:00', 60, null)).toBe(true);
  });

  // ===== الساعة المحجوزة تفضل محجوزة =====
  it('الشغلانة بتبلوك ساعتها هي بس: 09:30 متعارض، و10:00 متاح', async () => {
    const day = dayAfter(32);
    await makeOrder(day, '09:00', { minutes: 60, days: 1 });
    expect(await isAvailable(day, '09:30', 60, 1)).toBe(false);
    expect(await isAvailable(day, '10:00', 60, 1)).toBe(true);
  });

  it('شغلانة 5 ساعات بتبلوك 5 ساعات بالظبط', async () => {
    const day = dayAfter(33);
    await makeOrder(day, '09:00', { minutes: 300, days: 1 });
    expect(await isAvailable(day, '13:00', 60, 1)).toBe(false);
    expect(await isAvailable(day, '14:00', 60, 1)).toBe(true);
  });

  // ===== اللي مايتغيّرش =====
  it('الشغل الممتد على أكتر من يوم لسه بياخد أيامه بالكامل', async () => {
    // **ADR-0077**: المدة الدقيقة بالدقايق بتغلب تقدير الأيام. شغلانة ٣ أيام «حقيقية» هي اللي
    // **مالهاش** تفصيل بالدقايق (قالب باليوم) — لو حطينا الاتنين مع بعض بنقيس الحالة اللي
    // الـADR شالها عمدًا (تقدير أيام قديم جنب مدة دقيقة) مش الحالة اللي الاختبار اسمه بيقولها.
    const day = dayAfter(34);
    await makeOrder(day, '09:00', { minutes: null, days: 3 });
    for (let offset = 0; offset < 3; offset += 1) {
      expect(await isAvailable(dayAfter(34 + offset), '18:00', 60, null)).toBe(false);
    }
    expect(await isAvailable(dayAfter(37), '18:00', 60, null)).toBe(true);
  });

  it('السقف اليومي لسه شغّال: 12 ساعة مشغولة ⇒ مفيش مكان', async () => {
    const day = dayAfter(35);
    await makeOrder(day, '08:00', { minutes: 6 * 60, days: 1 });
    await makeOrder(day, '14:00', { minutes: 6 * 60, days: 1 });
    expect(await isAvailable(day, '21:00', 60, 1)).toBe(false);
  });
});
