import { DataSource } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { OrderAssignment } from './entities/order-assignment.entity';
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
  let orderSeq = 0;
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function insertOrder(label: string): Promise<string> {
    const [order] = await q(
      `INSERT INTO orders (commission_rate_applied,order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents)
       VALUES (20,$1,$2,$3,$4,$5,'searching_technician',10000) RETURNING id`,
      // رقم الطلب لازم يبقى فريد **بعد** القصّ على 24 حرف. الصيغة القديمة
      // (`WO-${label}-${runId}`.slice(0,24)) كانت بتقصّ معرّف التشغيلة نفسه مع الـlabels الطويلة،
      // فبيحصل تصادم بين تشغيلتين — وكمان بين labels في نفس التشغيلة لو أول 12 حرف متشابهين
      // ("heavy-baseline" و"heavy-baseline-off"). العدّاد هو مصدر التفرّد الحقيقي دلوقتي،
      // والـlabel للقراءة بس.
      [`WO-${runId}-${++orderSeq}-${label}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
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

    // بيستخدم دولة موجودة بدل ما يعمل واحدة جديدة (نفس نمط باقي الاختبارات الحية).
    //
    // ليه اتغيّر: `countries.iso_code` مفتاح فريد من حرفين، والاختبار كان بيولّده عشوائي — يعني
    // مساحة صغيرة جدًا واحتمال تصادم عالي. وأسوأ: تنظيف `afterAll` كان بيفشل على قيود المفاتيح
    // الأجنبية فبيسيب صف دولة ورا كل تشغيلة، فالتصادم بيبقى مسألة وقت. النتيجة كانت فشل عابر
    // في السويت كلها من غير أي علاقة بالكود اللي بيتغيّر (docs/08 §63 شريحة 5).
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
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
       VALUES ($1,$2,$3,'formula',10000,60) RETURNING id`,
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
      // الدولة مش بتتمسح — مش بتاعة الاختبار ده أصلاً (موجودة قبله).
    } finally {
      await dataSource.destroy();
    }
  });

  it('العروض القديمة تظل ظاهرة وقابلة للقرار، لكن التوزيع الجديد لا ينشئ فرص تعيين', async () => {
    const orderId = await insertOrder('legacy');
    const [opportunity] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status)
       VALUES ($1,$2,'MEANINGFUL','offered') RETURNING id`, [orderId, ids.meaningfulTechProfile],
    );
    expect((await matchingService.listWorkOpportunitiesForUser(ids.meaningfulTechUser))
      .some(o => o.id === opportunity.id)).toBe(true);
    await matchingService.declineWorkOpportunity(ids.meaningfulTechUser, opportunity.id);
    expect((await q(`SELECT status FROM technician_work_opportunities WHERE id=$1`, [opportunity.id]))[0].status).toBe('declined');
    await expect(matchingService.acceptWorkOpportunity(ids.meaningfulTechUser, opportunity.id)).rejects.toBeDefined();
    expect(await q(`SELECT id FROM technician_work_opportunities WHERE order_id=$1`, [orderId])).toHaveLength(1);
  });

  it('قبول عرض قديم يعيد فحص الإتاحة الفعلية ويرفض اليوم المحظور', async () => {
    const orderId = await insertOrder('blocked-legacy');
    const [opportunity] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status)
       VALUES ($1,$2,'MEANINGFUL','offered') RETURNING id`, [orderId, ids.meaningfulTechProfile],
    );
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await q(`INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
      VALUES ($1,$2,'00:00:00','23:59:59','blocked')`, [ids.meaningfulTechProfile, today]);
    await expect(matchingService.acceptWorkOpportunity(ids.meaningfulTechUser, opportunity.id)).rejects.toBeDefined();
    expect((await q(`SELECT status FROM technician_work_opportunities WHERE id=$1`, [opportunity.id]))[0].status).toBe('offered');
    await q(`DELETE FROM technician_schedule_slots WHERE technician_id=$1`, [ids.meaningfulTechProfile]);
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
