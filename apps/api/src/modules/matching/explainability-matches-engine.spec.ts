import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { MatchingExplainabilityService } from './matching-explainability.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

/**
 * **مفتّش المطابقة لازم يقول نفس كلام المحرك بالحرف** (طلب مالك 2026-09-15، docs/08 §151).
 *
 * > «راجع الجزء اللي في الأدمين اللي بيبقى آخر كل طلب… إزاي الفني ده اختار وليه الفني ده
 * >  ما اختارش، وتتأكد إن كل الأسباب منطقية وصحيحة ومافيش أي بوج.»
 *
 * الملف ده بيقيس **الثابت الحاكم** مش نصوص الأسباب: لكل سيناريو،
 * `explainTechnicianForOrder().eligible` لازم يساوي «هل `findEligibleTechnicians()` رجّعه
 * فعلاً؟». الصياغة دي مقصودة — أي شرط جديد يتضاف للمحرك ويتنسى في المفتّش بيفشل هنا تلقائيًا،
 * بدل ما نعتمد على إن حد يفتكر يحدّث قايمة اختبارات مكتوبة بالإيد.
 *
 * التلات حالات دي **كانت بتفشل فعلاً** قبل الإصلاح (تلات شروط في المحرك وناقصة من المفتّش):
 *  1. ADR-0086 — الخدمة المشترطة فني كامل مقابل مساعد.
 *  2. ADR-0080 — «حصري للشركة» في توزيع عام.
 *  3. صف عرض حي في `technician_work_opportunities` (جدول مستقل عن `order_assignments`).
 */
describe('مفتّش المطابقة مطابق للمحرك (docs/08 §151)', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let matching: MatchingService;
  let explain: MatchingExplainabilityService;

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids: Record<string, string> = {};
  const users: string[] = [];
  const orders: string[] = [];
  let seq = 0;

  const q = <T = Record<string, string>>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params);

  const settingsStub = {
    getNumber: jest.fn(async (_k: string, f: number) => f),
    getString: jest.fn(async (_k: string, f: string) => f),
    getBoolean: jest.fn(async (_k: string, f: boolean) => f),
  };

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
      new TechnicianAssignmentGuardService(settingsStub as never),
      settingsStub as never,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );
    explain = new MatchingExplainabilityService(dataSource, settingsStub as never, matching);

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
  });

  afterAll(async () => {
    if (orders.length) {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orders]);
    }
    if (users.length) {
      const profiles = `(SELECT id FROM technician_profiles WHERE user_id = ANY($1::uuid[]))`;
      await q(`DELETE FROM technician_zones WHERE technician_id IN ${profiles}`, [users]);
      await q(`DELETE FROM technician_services WHERE technician_id IN ${profiles}`, [users]);
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
    await q(`DELETE FROM services WHERE category_id = $1`, [ids.category]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  const makeUser = async (type: 'technician' | 'customer') => {
    seq += 1;
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3) RETURNING id`,
      [`+2014${runId.slice(0, 6)}${seq}`.slice(0, 15), `${type} ${runId} ${seq}`, type],
    );
    users.push(user.id);
    return user.id as string;
  };

  const makeService = async (opts: { requiresTechnicianLead?: boolean } = {}) => {
    seq += 1;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,commission_percentage,
                             warranty_days,estimated_duration_minutes,requires_start_time_only,allows_emergency,
                             requires_technician_lead)
       VALUES ($1,$2,$3,'formula',25000,20,0,90,false,false,$4) RETURNING id`,
      [ids.category, `خدمة ${runId} ${seq}`, `svc-${runId}-${seq}`, opts.requiresTechnicianLead ?? false],
    );
    return svc.id as string;
  };

  const makeTechnician = async (
    serviceId: string,
    opts: { kind?: 'technician' | 'assistant'; companyId?: string; companyExclusive?: boolean } = {},
  ) => {
    const userId = await makeUser('technician');
    seq += 1;
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
          technician_kind, current_location, company_id, company_exclusive)
       VALUES ($1,$2,'premium','approved',true,true,$3,
               ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,$4,$5) RETURNING id`,
      [
        userId,
        `EXP${runId.slice(0, 8)}${seq}`.slice(0, 20),
        opts.kind ?? 'technician',
        opts.companyId ?? null,
        opts.companyExclusive ?? false,
      ],
    );
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [profile.id, serviceId],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      profile.id,
      ids.zone,
    ]);
    return profile.id as string;
  };

  const makeOrder = async (serviceId: string, opts: { companyId?: string } = {}) => {
    const userId = await makeUser('customer');
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [userId]);
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'ش','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [userId, ids.city],
    );
    const scheduledAt = new Date(Date.now() + 6 * 86_400_000);
    scheduledAt.setUTCHours(9, 0, 0, 0);
    seq += 1;
    const [order] = await q(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, requested_technician_company_id,
         total_amount_cents, payment_method, commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,'searching_technician','individual',$6,90,$7,25000,'cash',20.00) RETURNING id`,
      [profile.id, serviceId, address.id, ids.zone, `EXP-${runId}-${seq}`, scheduledAt, opts.companyId ?? null],
    );
    orders.push(order.id);
    return dataSource.getRepository(Order).findOneOrFail({ where: { id: order.id } });
  };

  /**
   * **الثابت الحاكم**: المفتّش بيقول «مؤهّل» **لو وبس لو** المحرك رجّع الشخص فعلاً.
   *
   * بيرجّع الاتنين عشان رسالة الفشل تقول مين خالف مين، مش بس إن فيه اختلاف.
   */
  const compare = async (order: Order, technicianId: string) => {
    const candidates = await matching.findEligibleTechnicians(
      order,
      10_000,
      order.requestedTechnicianId,
      false,
      order.requestedTechnicianCompanyId,
    );
    const explanation = await explain.explainTechnicianForOrder(order, technicianId);
    return {
      engineSaysEligible: candidates.some((c) => c.technician_id === technicianId),
      inspectorSaysEligible: explanation.eligible,
      failedChecks: explanation.checks.filter((c) => !c.passed).map((c) => c.key),
    };
  };

  it('ضابط: فني كامل على خدمة عادية ⇒ المحرك والمفتّش الاتنين بيقولوا مؤهّل', async () => {
    const serviceId = await makeService();
    const tech = await makeTechnician(serviceId);
    const order = await makeOrder(serviceId);
    const result = await compare(order, tech);
    expect(result.engineSaysEligible).toBe(true);
    expect(result.inspectorSaysEligible).toBe(true);
    expect(result.failedChecks).toEqual([]);
  });

  it('ADR-0086 — خدمة مشترطة فني كامل + مساعد ⇒ الاتنين بيقولوا مش مؤهّل، والسبب بيسمّي القيادة', async () => {
    const serviceId = await makeService({ requiresTechnicianLead: true });
    const assistant = await makeTechnician(serviceId, { kind: 'assistant' });
    const order = await makeOrder(serviceId);
    const result = await compare(order, assistant);
    expect(result.engineSaysEligible).toBe(false);
    expect(result.inspectorSaysEligible).toBe(false);
    expect(result.failedChecks).toContain('technician_lead_ok');
  });

  it('ADR-0080 — حصري للشركة في توزيع عام ⇒ الاتنين بيقولوا مش مؤهّل', async () => {
    const serviceId = await makeService();
    const ownerId = await makeUser('technician');
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id,name,is_active) VALUES ($1,$2,true) RETURNING id`,
      [ownerId, `شركة ${runId} ${seq}`],
    );
    const exclusive = await makeTechnician(serviceId, { companyId: company.id, companyExclusive: true });
    const order = await makeOrder(serviceId); // طلب عام، بلا شركة
    const result = await compare(order, exclusive);
    expect(result.engineSaysEligible).toBe(false);
    expect(result.inspectorSaysEligible).toBe(false);
    expect(result.failedChecks).toContain('individually_visible');
  });

  it('ADR-0080 — نفس الحصري لكن الطلب بتاع شركته ⇒ الاتنين بيقولوا مؤهّل (الضابط العكسي)', async () => {
    const serviceId = await makeService();
    const ownerId = await makeUser('technician');
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id,name,is_active) VALUES ($1,$2,true) RETURNING id`,
      [ownerId, `شركة ${runId} ${seq}`],
    );
    const exclusive = await makeTechnician(serviceId, { companyId: company.id, companyExclusive: true });
    const order = await makeOrder(serviceId, { companyId: company.id });
    const result = await compare(order, exclusive);
    expect(result.engineSaysEligible).toBe(true);
    expect(result.inspectorSaysEligible).toBe(true);
  });

  it('عرض حي في technician_work_opportunities ⇒ الاتنين بيقولوا مش مؤهّل (الجدول ده مستقل عن order_assignments)', async () => {
    const serviceId = await makeService();
    const tech = await makeTechnician(serviceId);
    const order = await makeOrder(serviceId);
    // قبل العرض: الضابط — الاتنين بيقولوا مؤهّل.
    expect(await compare(order, tech)).toMatchObject({ engineSaysEligible: true, inspectorSaysEligible: true });

    await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status, context)
       VALUES ($1,$2,'LIGHT','offered','assignment')`,
      [order.id, tech],
    );
    const result = await compare(order, tech);
    expect(result.engineSaysEligible).toBe(false);
    expect(result.inspectorSaysEligible).toBe(false);
    expect(result.failedChecks).toContain('not_already_offered');
  });
});
