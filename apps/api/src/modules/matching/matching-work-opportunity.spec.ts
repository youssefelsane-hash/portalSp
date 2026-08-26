import { DataSource } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { classifyTechnicianCapacity } from '../technicians/technician-eligibility.sql';
import { WORK_OPPORTUNITY_OFFERED_EVENT } from '../../common/events/work-opportunity-offered.event';
import { AssignmentStatus, OrderAssignment } from './entities/order-assignment.entity';
import { MatchingService } from './matching.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

// طلبات شغل إضافي اختيارية (docs/08 §34.1/§34.1b، ADR-0020) — اختبار حي شامل ضد Postgres حقيقي:
// فني LIGHT (فاضي) يتأكد تلقائيًا زي ما هو بالحرف (بلا فرصة)، فني MEANINGFUL (عنده شغل قصير نفس
// اليوم) يتعرضله فرصة اختيارية بدل تأكيد صامت، القبول بيعيد فحص الحالة تحت قفل، والرفض بيعيد
// المحاولة لمرشّح تاني فورًا.
describe('MatchingService — طلبات شغل إضافي اختيارية (docs/08 §34.1b)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let matchingService: MatchingService;
  let workOpportunities: TechnicianWorkOpportunitiesService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    lightTechUser: '',
    lightTechProfile: '',
    meaningfulTechUser: '',
    meaningfulTechProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
  };
  const orderIds: string[] = [];
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function insertOrder(label: string): Promise<string> {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',10000) RETURNING id`,
      [`WO-${label}-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    orderIds.push(order.id as string);
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const assignmentGuard = new TechnicianAssignmentGuardService({
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb)
    } as never);
    workOpportunities = new TechnicianWorkOpportunitiesService(dataSource);

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      assignmentGuard,
      {
        getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
        getBoolean: jest.fn(async (_key: string, fallback: boolean) => fallback),
        getString: jest.fn(async (_key: string, fallback: string) => fallback),
      } as never,
      { emit: () => true } as never,
      { add: async () => undefined } as never,
      workOpportunities,
      levelPremiumServiceStub(),
    );

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة فرص ${runId}`, `Opp Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة فرص ${runId}`, `Opp City ${runId}`, `opp-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق فرص ${runId}`,
      `Opp Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة فرص ${runId}`,
      `Opp Category ${runId}`,
      `opp-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',10000,60) RETURNING id`,
      [ids.category, `خدمة فرص ${runId}`, `opp-service-${runId}`],
    );
    ids.service = service.id;

    const makeTechnician = async (label: string) => {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+201${label}${runId}`.slice(0, 14),
        `فني فرص ${label} ${runId}`,
      ]);
      const [profile] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status, current_location)
         VALUES ($1,$2,'new','approved', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `WO${label}${runId}`.slice(0, 20)],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.service]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
      return { userId: user.id as string, profileId: profile.id as string };
    };

    const lightTech = await makeTechnician('L');
    ids.lightTechUser = lightTech.userId;
    ids.lightTechProfile = lightTech.profileId;
    const meaningfulTech = await makeTechnician('M');
    ids.meaningfulTechUser = meaningfulTech.userId;
    ids.meaningfulTechProfile = meaningfulTech.profileId;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+202${runId}`.slice(0, 14),
      `عميل فرص ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع فرص ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id IN ($1,$2)`, [ids.lightTechProfile, ids.meaningfulTechProfile]);
      await q(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [ids.lightTechProfile, ids.meaningfulTechProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [ids.lightTechProfile, ids.meaningfulTechProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [ids.lightTechProfile, ids.meaningfulTechProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.lightTechUser, ids.meaningfulTechUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('فني LIGHT (فاضي) — الطلب يتأكد تلقائيًا بلا أي فرصة اختيارية', async () => {
    const orderId = await insertOrder('light');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.lightTechProfile, orderId]);

    const result = await matchingService.autoConfirmScheduledOrder(orderId);
    expect(result.dispatched).toBe(1);

    const [order] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [orderId]);
    expect(order.order_status).toBe('accepted');
    expect(order.technician_id).toBe(ids.lightTechProfile);

    const opportunities = await q(`SELECT * FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
    expect(opportunities).toHaveLength(0);
  });

  it('فني MEANINGFUL (عنده طلب accepted قصير نفس اليوم) — فرصة اختيارية بدل تأكيد صامت', async () => {
    // نشغل الفني MEANINGFUL بطلب قصير مقبول النهاردة (بلا مدة يوم كامل).
    const baselineOrderId = await insertOrder('busy-baseline');
    await q(`UPDATE orders SET technician_id = $1, order_status = 'accepted' WHERE id = $2`, [
      ids.meaningfulTechProfile,
      baselineOrderId,
    ]);

    const orderId = await insertOrder('meaningful');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, orderId]);

    const result = await matchingService.autoConfirmScheduledOrder(orderId);
    expect(result.dispatched).toBe(0);

    const [order] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [orderId]);
    expect(order.order_status).toBe('searching_technician');
    expect(order.technician_id).toBeNull();

    const opportunities = await q(
      `SELECT * FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`,
      [orderId, ids.meaningfulTechProfile],
    );
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].status).toBe('offered');
    expect(opportunities[0].capacity_tier_at_offer).toBe('MEANINGFUL');

    // نداء تاني — عرض offered حي بالفعل، مفيش عرض جديد يتكرر (idempotent).
    await matchingService.autoConfirmScheduledOrder(orderId);
    const stillOne = await q(`SELECT * FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
    expect(stillOne).toHaveLength(1);

    // قبول الفرصة — الطلب يتأكد فعليًا، والفرصة تتحول accepted.
    const accepted = await matchingService.acceptWorkOpportunity(ids.meaningfulTechUser, opportunities[0].id);
    expect(accepted.orderStatus).toBe(OrderStatus.ACCEPTED);
    expect(accepted.technicianId).toBe(ids.meaningfulTechProfile);

    const [decided] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [opportunities[0].id]);
    expect(decided.status).toBe('accepted');
  });

  // بَقّة حقيقية اتلقطت (docs/08 §36.1، بلاغ مالك 2026-08-20): إنشاء صف technician_work_opportunities
  // ماكانش بيصدّر أي حدث خالص — عكس عرض order_assignments العادي (ORDER_OFFER_CREATED_EVENT). فني
  // مالوش أي إشعار حقيقي إن فرصة اختيارية موجودة، لازم يفتح/يحدّث شاشة الطلبات المتاحة بنفسه عشان
  // يكتشفها. الاختبار ده بيثبت الإصلاح: حدث WORK_OPPORTUNITY_OFFERED_EVENT بيتصدّر مرة واحدة بس
  // (مش عند إعادة نداء idempotent) بالبيانات الصح.
  it('فرصة اختيارية جديدة (context=assignment) بتصدّر حدث مرة واحدة بس — إصلاح البَقّة (docs/08 §36.1)', async () => {
    // meaningfulTechProfile دلوقتي عنده طلب accepted فعلي (من الاختبار اللي فات) — لسه MEANINGFUL
    // لطلب تاني نفس اليوم.
    const emit = jest.fn();
    const eventMatchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      new TechniciansService(
        dataSource.getRepository(TechnicianProfile),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb) } as never),
      {
        getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
        getBoolean: jest.fn(async (_key: string, fallback: boolean) => fallback),
        getString: jest.fn(async (_key: string, fallback: string) => fallback),
      } as never,
      { emit } as never,
      { add: async () => undefined } as never,
      workOpportunities,
      levelPremiumServiceStub(),
    );

    const orderId = await insertOrder('event-meaningful');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, orderId]);

    await eventMatchingService.autoConfirmScheduledOrder(orderId);
    const offeredCalls = emit.mock.calls.filter(([eventName]) => eventName === WORK_OPPORTUNITY_OFFERED_EVENT);
    expect(offeredCalls).toHaveLength(1);
    const [, payload] = offeredCalls[0];
    expect(payload.orderId).toBe(orderId);
    expect(payload.technicianId).toBe(ids.meaningfulTechProfile);
    expect(payload.context).toBe('assignment');
    expect(payload.capacityTier).toBe('MEANINGFUL');

    // نداء تاني idempotent — عرض offered حي بالفعل، مفيش حدث تاني يتصدّر.
    emit.mockClear();
    await eventMatchingService.autoConfirmScheduledOrder(orderId);
    expect(emit.mock.calls.filter(([eventName]) => eventName === WORK_OPPORTUNITY_OFFERED_EVENT)).toHaveLength(0);
  });

  it('فني HEAVY (شاغل يوم كامل) — لسه بيتعرضله فرصة، مش يفضل الطلب stalled بلا حل (docs/08 §34.1b بند 4)', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = ANY($1::uuid[])`, [
      [ids.meaningfulTechProfile, ids.lightTechProfile],
    ]);
    // شغل يوم كامل (estimated_duration_days=3) — الفني ده بس المرشّح المؤهّل، ومستبعد بالكامل من
    // الاستعلام الصارم (technicianAvailabilityCondition())، مش مجرد "مصنّف HEAVY في نتيجة راجعة".
    const heavyBaselineId = await insertOrder('heavy-baseline');
    await q(`UPDATE orders SET technician_id = $1, order_status = 'accepted', estimated_duration_days = 3 WHERE id = $2`, [
      ids.meaningfulTechProfile,
      heavyBaselineId,
    ]);
    // الفني التاني (lightTechProfile) لازم يكون مش مؤهّل/مشغول برضه هنا — غير كده هو هيبقى مرشّح
    // LIGHT حقيقي وييجي عليه التأكيد التلقائي العادي بدل ما نختبر مسار HEAVY بالظبط.
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date, '00:00:00','23:59:59','blocked')`,
      [ids.lightTechProfile],
    );

    const orderId = await insertOrder('heavy');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, orderId]);

    const result = await matchingService.autoConfirmScheduledOrder(orderId);
    expect(result.dispatched).toBe(0);

    const [order] = await q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    expect(order.order_status).toBe('searching_technician');

    const [opportunity] = await q(
      `SELECT * FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`,
      [orderId, ids.meaningfulTechProfile],
    );
    expect(opportunity).toBeDefined();
    expect(opportunity.status).toBe('offered');
    expect(opportunity.capacity_tier_at_offer).toBe('HEAVY');

    // تنظيف — الفني الفاضي لازم يرجع فاضي لأي اختبار بعده.
    await q(`UPDATE technician_schedule_slots SET deleted_at = now() WHERE technician_id = $1`, [ids.lightTechProfile]);
  });

  it('فني HEAVY لا يتعرضله فرصة لو matching.offer_heavy_workload_technicians معطّل — الطلب يفضل يدوّر بلا فرصة', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = ANY($1::uuid[])`, [
      [ids.meaningfulTechProfile, ids.lightTechProfile],
    ]);
    const heavyBaselineId2 = await insertOrder('heavy-baseline-off');
    await q(`UPDATE orders SET technician_id = $1, order_status = 'accepted', estimated_duration_days = 3 WHERE id = $2`, [
      ids.meaningfulTechProfile,
      heavyBaselineId2,
    ]);
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date, '00:00:00','23:59:59','blocked')`,
      [ids.lightTechProfile],
    );

    const orderId = await insertOrder('heavy-off');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, orderId]);

    const noOfferService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      new TechniciansService(
        dataSource.getRepository(TechnicianProfile),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb) } as never),
      {
        getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
        getBoolean: jest.fn(async () => false),
      } as never,
      { emit: () => true } as never,
      { add: async () => undefined } as never,
      workOpportunities,
      levelPremiumServiceStub(),
    );

    const result = await noOfferService.autoConfirmScheduledOrder(orderId);
    expect(result.dispatched).toBe(0);
    const opportunities = await q(`SELECT * FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
    expect(opportunities).toHaveLength(0);
    const [order] = await q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    expect(order.order_status).toBe('searching_technician');

    await q(`UPDATE technician_schedule_slots SET deleted_at = now() WHERE technician_id = $1`, [ids.lightTechProfile]);
  });

  it('إتمام الشغل الحالي بيرجّع الفني LIGHT فورًا حتى لو عنده فرصة اختيارية لسه مفتوحة (docs/08 §34 بند L)', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.meaningfulTechProfile]);
    const jobAId = await insertOrder('job-a');
    await q(`UPDATE orders SET technician_id = $1, order_status = 'accepted' WHERE id = $2`, [ids.meaningfulTechProfile, jobAId]);

    // فرصة اختيارية (Job B) اتعرضت بسبب Job A لسه شغال.
    const jobBId = await insertOrder('job-b');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, jobBId]);
    await matchingService.autoConfirmScheduledOrder(jobBId);
    const [openOpportunity] = await q(`SELECT * FROM technician_work_opportunities WHERE order_id = $1`, [jobBId]);
    expect(openOpportunity.status).toBe('offered');

    // Job A يخلص فعليًا (completed) — القدرة الاستيعابية لازم ترجع LIGHT فورًا، بلا أي cache قديم.
    await q(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [jobAId]);
    const tierAfterCompletion = await classifyTechnicianCapacity(dataSource, {
      technicianId: ids.meaningfulTechProfile,
      scheduledAt: null,
      excludeOrderId: jobBId,
      serviceDurationMinutes: 60,
      fullDayThresholdMinutes: 360,
    });
    expect(tierAfterCompletion).toBe('LIGHT');

    // طلب تالت جديد لنفس الفني — بما إنه بقى LIGHT فعليًا، يتأكد تلقائيًا بلا فرصة تانية.
    const jobCId = await insertOrder('job-c');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, jobCId]);
    const result = await matchingService.autoConfirmScheduledOrder(jobCId);
    expect(result.dispatched).toBe(1);
    const [orderC] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [jobCId]);
    expect(orderC.order_status).toBe('accepted');
    expect(orderC.technician_id).toBe(ids.meaningfulTechProfile);
  });

  it('رفض الفرصة — الطلب يفضل يدوّر، وقبول متأخر على فرصة مرفوضة يترفض بوضوح', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.meaningfulTechProfile]);
    const baselineOrderId2 = await insertOrder('busy-baseline-2');
    await q(`UPDATE orders SET technician_id = $1, order_status = 'accepted' WHERE id = $2`, [
      ids.meaningfulTechProfile,
      baselineOrderId2,
    ]);

    const orderId = await insertOrder('decline');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, orderId]);
    await matchingService.autoConfirmScheduledOrder(orderId);

    const [opportunity] = await q(`SELECT * FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
    expect(opportunity.status).toBe('offered');

    await matchingService.declineWorkOpportunity(ids.meaningfulTechUser, opportunity.id);

    const [decided] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [opportunity.id]);
    expect(decided.status).toBe('declined');

    // الطلب فضل بلا فني مؤهّل غير المرفوض (requestedTechnicianId مقفول عليه)، فيفضل SEARCHING_TECHNICIAN.
    const [order] = await q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    expect(order.order_status).toBe('searching_technician');

    // قبول متأخر على فرصة اترفضت بالفعل يترفض بوضوح، مش نجاح صامت.
    await expect(matchingService.acceptWorkOpportunity(ids.meaningfulTechUser, opportunity.id)).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });
  });

  it('قبول فرصة بيعيد فحص الحالة الحقيقية تحت قفل — الفني حظر اليوم بعد العرض، القبول يترفض بوضوح (Scenario K)', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.meaningfulTechProfile]);
    await q(`UPDATE technician_schedule_slots SET deleted_at = now() WHERE technician_id = $1`, [ids.meaningfulTechProfile]);
    const baselineId = await insertOrder('recheck-baseline');
    await q(`UPDATE orders SET technician_id = $1, order_status = 'accepted' WHERE id = $2`, [ids.meaningfulTechProfile, baselineId]);

    const orderId = await insertOrder('recheck');
    await q(`UPDATE orders SET requested_technician_id = $1 WHERE id = $2`, [ids.meaningfulTechProfile, orderId]);
    await matchingService.autoConfirmScheduledOrder(orderId);
    const [opportunity] = await q(`SELECT * FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
    expect(opportunity.status).toBe('offered');

    // الفني حظر اليوم بنفسه بعد ما الفرصة اتعرضت عليه — العرض لسه offered (ظاهر في الشاشة)، بس
    // الحالة الحقيقية اتغيّرت. القبول لازم يعيد الفحص تحت قفل ويترفض، مش ينجح بناءً على الفرصة
    // الظاهرة القديمة.
    // "اليوم" بتوقيت القاهرة زي بالظبط classifyTechnicianCapacity() (مش UTC خام) — فرق التوقيت
    // الصيفي بيخلق نافذة ساعتين كل ليلة تاريخ القاهرة بيبقى فيها يوم قدّام UTC.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1,$2,'00:00:00','23:59:59','blocked')`,
      [ids.meaningfulTechProfile, today],
    );

    await expect(matchingService.acceptWorkOpportunity(ids.meaningfulTechUser, opportunity.id)).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });
    const [stillOffered] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [opportunity.id]);
    expect(stillOffered.status).toBe('offered');
    const [order] = await q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    expect(order.order_status).toBe('searching_technician');

    // تنظيف — منعًا لتلوّث اختبارات تانية بعد كده بيستخدموا نفس الفني.
    await q(`UPDATE technician_schedule_slots SET deleted_at = now() WHERE technician_id = $1`, [ids.meaningfulTechProfile]);
  });

  it('شفافية الأدمن — listForOrderAdmin() بيرجّع تاريخ الفرص كامل مع اسم الفني (docs/08 §34.4)', async () => {
    const orderId = await insertOrder('admin-visibility');
    const [opp1] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status)
       VALUES ($1,$2,'MEANINGFUL','declined') RETURNING id`,
      [orderId, ids.lightTechProfile],
    );
    const [opp2] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status)
       VALUES ($1,$2,'HEAVY','offered') RETURNING id`,
      [orderId, ids.meaningfulTechProfile],
    );

    const rows = await workOpportunities.listForOrderAdmin(orderId);
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(opp1.id)).toMatchObject({ status: 'declined', capacity_tier_at_offer: 'MEANINGFUL', technician_id: ids.lightTechProfile });
    expect(byId.get(opp1.id)?.technician_full_name).toContain('فني فرص L');
    expect(byId.get(opp2.id)).toMatchObject({ status: 'offered', capacity_tier_at_offer: 'HEAVY', technician_id: ids.meaningfulTechProfile });
  });

  it('فنيين اتنين بيقبلوا فرصتين على نفس الطلب بالتوازي — واحد بس يفوز (Scenario I، ADR-0020 §4)', async () => {
    const orderId = await insertOrder('race');
    const [lightOpp] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status)
       VALUES ($1,$2,'MEANINGFUL','offered') RETURNING *`,
      [orderId, ids.lightTechProfile],
    );
    const [meaningfulOpp] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status)
       VALUES ($1,$2,'MEANINGFUL','offered') RETURNING *`,
      [orderId, ids.meaningfulTechProfile],
    );

    const results = await Promise.allSettled([
      matchingService.acceptWorkOpportunity(ids.lightTechUser, lightOpp.id),
      matchingService.acceptWorkOpportunity(ids.meaningfulTechUser, meaningfulOpp.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const [order] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [orderId]);
    expect(order.order_status).toBe('accepted');

    // الفرصة اللي فازت بقت accepted، والتانية اترفضت (بلا أي فحص إضافي هنا — لسه offered لأنها
    // اترفضت جوّه الـtransaction قبل أي تحديث، مش closed خالص لسه لأن مفيش confirm نجح ليقفلها).
    const opportunities = await q(`SELECT status, technician_id FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
    const acceptedCount = opportunities.filter((o: { status: string }) => o.status === 'accepted').length;
    expect(acceptedCount).toBe(1);
    expect(opportunities.find((o: { technician_id: string }) => o.technician_id === order.technician_id)?.status).toBe('accepted');
  });
});
