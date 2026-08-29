import { DataSource } from 'typeorm';
import { MatchingExplainabilityService } from './matching-explainability.service';
import { MatchingService } from './matching.service';
import { SettingsService } from '../settings/settings.service';
import { Order } from '../orders/entities/order.entity';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

// اختبار حي ضد Postgres حقيقي — تفسير مطابقة (docs/08 §35.7، ADR-0021 §4): "ليه الفني ده مش
// بياخد الطلب ده؟" لازم يعتمد على نفس شروط MatchingService.findEligibleTechnicians() الحقيقية
// بالحرف، صفر خوارزمية تشخيصية موازية. كل فني هنا مصمّم يفشل check واحد بالظبط عشان نتأكد إن
// كل check بيتحسب صح ومستقل عن الباقي.
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback, getBoolean: async (_key: string, fallback: boolean) => fallback } as unknown as SettingsService;

describe('MatchingExplainabilityService — تفسير مطابقة (docs/08 §35.7)', () => {
  let dataSource: DataSource;
  let service: MatchingExplainabilityService;
  const runId = Date.now().toString(36);
  const ids = {
    zone: '',
    otherZone: '',
    city: '',
    country: '',
    category: '',
    service: '',
    customerProfile: '',
    address: '',
    order: '',
    teamOrder: '',
    eligibleProfile: '',
    wrongCategoryProfile: '',
    wrongZoneProfile: '',
    noLocationProfile: '',
    blockedProfile: '',
    alreadyOfferedProfile: '',
  };
  const users: string[] = [];
  let phoneCounter = 0;

  function nextPhone(): string {
    const counter = (phoneCounter++).toString().padStart(2, '0');
    return `+2048${runId.slice(-6)}${counter}`.slice(0, 15);
  }

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertTechnician(label: string, opts: { hasLocation: boolean; zoneId?: string | null }) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني تفسير ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',3,'professional','approved',true, ${opts.hasLocation ? "ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography" : 'NULL'})
       RETURNING id`,
      [user.id, `TCEXP${label}${runId}`.slice(0, 20)],
    );
    const profileId = profile.id as string;
    await q(
      `INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`,
      [profileId, ids.service],
    );
    if (opts.zoneId) {
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profileId, opts.zoneId]);
    }
    return profileId;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order],
    });
    await dataSource.initialize();

    // docs/08 §36.6 — findEligibleTechnicians() بقت مُعاد استخدامها بالحرف جوّه
    // explainTechnicianForOrder() لحساب rank_score/ترتيب الفني الحقيقي. الدالة دي بتلمس بس
    // dataSource/settingsService — باقي الـdependencies هنا stub خام (مش مستخدَمة أصلاً في
    // findEligibleTechnicians()، نفس نمط matching-work-opportunity.spec.ts).
    const matchingServiceForRanking = new MatchingService(
      {} as never,
      {} as never,
      dataSource,
      {} as never,
      {} as never,
      settingsServiceStub,
      {} as never,
      {} as never,
      {} as never,
      levelPremiumServiceStub(),
    );
    service = new MatchingExplainabilityService(dataSource, settingsServiceStub, matchingServiceForRanking);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة تفسير ${runId}`,
      `Explain City ${runId}`,
      `test-explain-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تفسير ${runId}`,
      `Explain Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [otherZone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تاني تفسير ${runId}`,
      `Explain Other Zone ${runId}`,
    ]);
    ids.otherZone = otherZone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تفسير ${runId}`,
      `Explain Category ${runId}`,
      `test-explain-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service_] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',30000,20,0,60) RETURNING id`,
      [ids.category, `خدمة تفسير ${runId}`, `test-explain-service-${runId}`],
    );
    ids.service = service_.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2049${runId}`.slice(0, 15),
      `عميل تفسير ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تفسير ${runId}`],
    );
    ids.address = address.id;

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,'searching_technician','pending',30000,0,'individual') RETURNING id`,
      [`TESTEXP-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    ids.eligibleProfile = await insertTechnician('eligible', { hasLocation: true, zoneId: ids.zone });
    ids.wrongZoneProfile = await insertTechnician('wrongzone', { hasLocation: true, zoneId: ids.otherZone });
    ids.noLocationProfile = await insertTechnician('nolocation', { hasLocation: false, zoneId: ids.zone });
    ids.blockedProfile = await insertTechnician('blocked', { hasLocation: true, zoneId: ids.zone });
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date, '00:00', '23:59', 'blocked')`,
      [ids.blockedProfile],
    );
    ids.alreadyOfferedProfile = await insertTechnician('offered', { hasLocation: true, zoneId: ids.zone });
    await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'rejected', now(), now())`,
      [ids.order, ids.alreadyOfferedProfile],
    );

    // فني بفئة مختلفة تمامًا (بلا technician_services ولا technician_categories لخدمة الاختبار).
    const [wrongUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني فئة غلط تفسير ${runId}`,
    ]);
    users.push(wrongUser.id);
    const [wrongProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',1,'new','approved',true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [wrongUser.id, `TCEXPWRONG${runId}`.slice(0, 20)],
    );
    ids.wrongCategoryProfile = wrongProfile.id;
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      ids.wrongCategoryProfile,
      ids.zone,
    ]);
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = $1`, [ids.teamOrder]);
      await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.teamOrder]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.teamOrder]);
      await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.blockedProfile]);
      const allProfiles = [
        ids.eligibleProfile,
        ids.wrongZoneProfile,
        ids.noLocationProfile,
        ids.blockedProfile,
        ids.alreadyOfferedProfile,
        ids.wrongCategoryProfile,
      ];
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [allProfiles]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [allProfiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [allProfiles]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1::uuid[])`, [[ids.zone, ids.otherZone]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  async function orderRow() {
    const repo = dataSource.getRepository(Order);
    const order = await repo.findOneOrFail({ where: { id: ids.order } });
    return order;
  }

  it('فني مؤهّل بالكامل — eligible=true، كل الـchecks ناجحة، capacityTier=LIGHT، rankInfo حقيقي (docs/08 §36.6)', async () => {
    const order = await orderRow();
    const result = await service.explainTechnicianForOrder(order, ids.eligibleProfile);
    expect(result.eligible).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.checks.find((c) => c.key === 'decision_limit_ok')?.passed).toBe(true);
    expect(result.capacityTier).toBe('LIGHT');
    expect(result.distanceKm).not.toBeNull();
    // docs/08 §36.6 — rank_score/ترتيب حقيقي مُعاد استخدامه من findEligibleTechnicians() بالحرف،
    // مش صفر مُلفَّق. الفني ده الوحيد المؤهّل فعليًا في الفكستشر ده، يبقى rank=1.
    expect(result.rankInfo).not.toBeNull();
    expect(result.rankInfo?.rank).toBe(1);
    expect(result.rankInfo?.totalEligible).toBeGreaterThanOrEqual(1);
    expect(typeof result.rankInfo?.rankScore).toBe('number');
  });

  it('rankInfo=null لفني مش ضمن المجمّع المؤهّل فعليًا (نطاق غلط)', async () => {
    const order = await orderRow();
    const result = await service.explainTechnicianForOrder(order, ids.wrongZoneProfile);
    expect(result.rankInfo).toBeNull();
  });

  it('حد قرار مستوى الفني أقل من قيمة الطلب — decision_limit_ok=false، eligible=false (docs/08 §36.6، بَقّة حقيقية اتصلحت)', async () => {
    // فني جديد وحد قراره قابل للتعديل من الأدمن؛ الاختبار يستخدم القيمة الحية بدل افتراض seed ثابت.
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني حد قرار تفسير ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',1,'new','approved',true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [user.id, `TCEXPLIM${runId}`.slice(0, 20)],
    );
    const lowLimitProfile = profile.id as string;
    await q(`INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`, [
      lowLimitProfile,
      ids.service,
    ]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [lowLimitProfile, ids.zone]);

    try {
      const [levelConfig] = await q(`SELECT decision_limit_cents FROM technician_level_config WHERE level = 'new'`);
      const decisionLimit = Number(levelConfig?.decision_limit_cents);
      expect(decisionLimit).toBeGreaterThan(0);
      const order = await orderRow();
      order.totalAmountCents = decisionLimit + 1;
      const result = await service.explainTechnicianForOrder(order, lowLimitProfile);
      expect(result.eligible).toBe(false);
      expect(result.checks.find((c) => c.key === 'decision_limit_ok')?.passed).toBe(false);
      expect(result.rankInfo).toBeNull();
    } finally {
      await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [lowLimitProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id = $1`, [lowLimitProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [lowLimitProfile]);
    }
  });

  it('فني بفئة/خدمة مختلفة — category_eligible=false، eligible=false', async () => {
    const order = await orderRow();
    const result = await service.explainTechnicianForOrder(order, ids.wrongCategoryProfile);
    expect(result.eligible).toBe(false);
    const check = result.checks.find((c) => c.key === 'category_eligible');
    expect(check?.passed).toBe(false);
    expect(result.reasonAr).toContain('فئة/خدمة');
  });

  it('فني مش مفعّل في نطاق الطلب — zone_eligible=false، eligible=false', async () => {
    const order = await orderRow();
    const result = await service.explainTechnicianForOrder(order, ids.wrongZoneProfile);
    expect(result.eligible).toBe(false);
    expect(result.checks.find((c) => c.key === 'zone_eligible')?.passed).toBe(false);
  });

  it('فني بلا موقع GPS — has_location=false، eligible=false', async () => {
    const order = await orderRow();
    const result = await service.explainTechnicianForOrder(order, ids.noLocationProfile);
    expect(result.eligible).toBe(false);
    expect(result.checks.find((c) => c.key === 'has_location')?.passed).toBe(false);
    expect(result.distanceKm).toBeNull();
  });

  it('فني حاظر النهاردة (blocked) — availability_ok=false، eligible=false، capacityTier=BLOCKED', async () => {
    const order = await orderRow();
    const result = await service.explainTechnicianForOrder(order, ids.blockedProfile);
    expect(result.eligible).toBe(false);
    expect(result.checks.find((c) => c.key === 'availability_ok')?.passed).toBe(false);
    expect(result.capacityTier).toBe('BLOCKED');
  });

  it('فني اتعرض عليه الطلب ده قبل كده (order_assignments) — not_already_offered=false، eligible=false', async () => {
    const order = await orderRow();
    const result = await service.explainTechnicianForOrder(order, ids.alreadyOfferedProfile);
    expect(result.eligible).toBe(false);
    expect(result.checks.find((c) => c.key === 'not_already_offered')?.passed).toBe(false);
  });

  it('طلب مالوش service_zone_id — بيرمي خطأ واضح بدل استعلام بلا معنى', async () => {
    const order = await orderRow();
    order.serviceZoneId = null;
    await expect(service.explainTechnicianForOrder(order, ids.eligibleProfile)).rejects.toThrow();
  });

  // docs/08 §35.8 — فانل مطابقة الطلب. نفس فنيي الفيكستشر فوق بالظبط: category_eligible=5 (كل
  // الفنيين ما عدا wrongCategoryProfile)، zone_eligible=4 (كل اللي فوق ما عدا wrongZoneProfile)،
  // ومنهم: blocked=1 (blockedProfile)، light=3 (eligible/noLocation/alreadyOffered — تصنيف القدرة
  // بيتجاهل GPS/order_assignments عمدًا، مش نفس شروط explainTechnicianForOrder()).
  it('explainOrderFunnel() — أعداد الفانل الحقيقية مطابقة لفنيي الفيكستشر بالظبط', async () => {
    const order = await orderRow();
    const funnel = await service.explainOrderFunnel(order);
    expect(funnel.pool.categoryEligible).toBe(5);
    expect(funnel.pool.zoneEligible).toBe(4);
    expect(funnel.pool.blocked).toBe(1);
    expect(funnel.pool.heavy).toBe(0);
    expect(funnel.pool.meaningful).toBe(0);
    expect(funnel.pool.light).toBe(3);
    expect(funnel.dispatchAssignments.rejected).toBe(1);
    expect(funnel.dispatchAssignments.sent).toBe(0);
    expect(funnel.crewStatus).toBeNull();
    expect(funnel.crewRecruitOpportunities).toBeNull();
  });

  it('explainOrderFunnel() — طلب فريق بيرجّع crew_status + crew_recruit_opportunities بدل null', async () => {
    const [teamOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians, required_assistants)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','pending',30000,0,'team',3,0) RETURNING id`,
      [`TESTEXPTM-${runId}`.slice(0, 24), ids.customerProfile, ids.eligibleProfile, ids.service, ids.address, ids.zone],
    );
    ids.teamOrder = teamOrder.id;
    await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, context, crew_role, capacity_tier_at_offer, status, offered_at)
       VALUES ($1,$2,'crew_recruit','technician','MEANINGFUL','offered', now())`,
      [ids.teamOrder, ids.noLocationProfile],
    );

    const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: ids.teamOrder } });
    const funnel = await service.explainOrderFunnel(order);
    expect(funnel.crewStatus).not.toBeNull();
    expect(funnel.crewStatus?.requiredTechnicians).toBe(3);
    expect(funnel.crewStatus?.assignedTechnicians).toBe(1); // بس القائد (+1)، مفيش أعضاء فريق لسه
    expect(funnel.crewStatus?.crewComplete).toBe(false);
    expect(funnel.crewRecruitOpportunities).not.toBeNull();
    expect(funnel.crewRecruitOpportunities?.offered).toBe(1);
  });
});
