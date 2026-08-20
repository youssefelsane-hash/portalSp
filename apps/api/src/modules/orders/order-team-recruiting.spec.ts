import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrderTeamService } from './order-team.service';
import { OrdersService } from './orders.service';
import { Order, BookingMode } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { User } from '../auth/entities/user.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile, TechnicianLevel, TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { SettingsService } from '../settings/settings.service';
import { ORDER_CREW_CHANGED_EVENT, OrderCrewChangedEvent } from '../../common/events/order-crew-changed.event';

// اختبار حي ضد Postgres حقيقي — تجنيد فريق ميداني ذاتي من الفني القائد (docs/08 §31/§35، طلب
// صريح من المالك 2026-08-20). مختلف عمدًا عن admin-crew-management.spec.ts: هنا القائد نفسه هو
// المُجنِّد (مش أدمن)، بلا قيد الشركة، مع فحص رتبة (TechnicianLevel) صريح.
//
// docs/08 §35، ADR-0021 §2 — بَقّتين حقيقيتين اتصلحوا هنا: (1) recruitMember() كانت بتفحص
// is_available (عمود اتشال من الأهلية بالكامل من ADR-0017) بدل technicianAvailabilityCondition()/
// classifyTechnicianCapacity() الحقيقيين — الفني "unavailableProfile" هنا بقى ممثّل بحظر يوم صريح
// (technician_schedule_slots) بدل is_available=false، عشان يعكس الأهلية الحقيقية. (2)
// getShortageForOrder() بقت getCrewComposition() — فني/مساعد منفصلين.
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

describe('OrderTeamService — تجنيد فريق ذاتي من الفني القائد (docs/08 §31/§35)', () => {
  let dataSource: DataSource;
  let orderTeamService: OrderTeamService;
  let ordersService: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    zone: '',
    city: '',
    country: '',
    category: '',
    service: '',
    customerProfile: '',
    address: '',
    leaderUser: '',
    leaderProfile: '',
    leaderCompany: '',
    juniorProfile: '',
    seniorProfile: '',
    blockedProfile: '',
    teamMateProfile: '',
    wrongCategoryProfile: '',
  };
  const users: string[] = [];
  let phoneCounter = 0;

  function nextPhone(): string {
    const counter = (phoneCounter++).toString().padStart(2, '0');
    return `+2049${runId.slice(-6)}${counter}`.slice(0, 15);
  }

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertTechnician(
    label: string,
    opts: { level: TechnicianLevel; hasLocation: boolean; companyId?: string | null },
  ) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location, company_id)
       VALUES ($1,$2,'x',3,$3,'approved',true, ${opts.hasLocation ? "ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography" : 'NULL'}, $4)
       RETURNING id`,
      [user.id, `TCREC${label}${runId}`.slice(0, 20), opts.level, opts.companyId ?? null],
    );
    const profileId = profile.id as string;
    await q(
      `INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`,
      [profileId, ids.service],
    );
    return profileId;
  }

  /** حظر اليوم الحالي (بتوقيت مصر) للفني ده — يمثّل "مش متاح فعليًا" الحقيقي (بديل is_available القديم). */
  async function blockToday(profileId: string) {
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date, '00:00', '23:59', 'blocked')`,
      [profileId],
    );
  }

  async function insertOrder(label: string, opts: { requiredTechnicians: number | null; requiredAssistants?: number | null }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians, required_assistants)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','pending',30000,0,'team',$7,$8) RETURNING id`,
      [
        `TESTREC-${label}`.slice(0, 24),
        ids.customerProfile,
        ids.leaderProfile,
        ids.service,
        ids.address,
        ids.zone,
        opts.requiredTechnicians,
        opts.requiredAssistants ?? 0,
      ],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderTeamMember, OrderStatusHistory, User, TechnicianProfile, TechnicianCompany],
    });
    await dataSource.initialize();

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة تجنيد ${runId}`, `Recruit Country ${runId}`, 'R' + runId.slice(0, 1).toUpperCase(), '+000', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة تجنيد ${runId}`,
      `Recruit City ${runId}`,
      `test-recruit-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تجنيد ${runId}`,
      `Recruit Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تجنيد ${runId}`,
      `Recruit Category ${runId}`,
      `test-recruit-category-${runId}`,
    ]);
    ids.category = category.id;
    const [otherCategory] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تانية ${runId}`,
      `Other Category ${runId}`,
      `test-other-category-${runId}`,
    ]);
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة تجنيد ${runId}`, `test-recruit-service-${runId}`],
    );
    ids.service = service.id;
    const [otherService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [otherCategory.id, `خدمة تانية ${runId}`, `test-other-service-${runId}`],
    );

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2044${runId}`.slice(0, 15),
      `عميل تجنيد ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تجنيد ${runId}`],
    );
    ids.address = address.id;

    // شركة/فريق دائم للقائد (docs/08 §35، ADR-0021 §2 — أولوية فريق القائد الدائم).
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
      [customerUser.id, `شركة تجنيد ${runId}`],
    );
    ids.leaderCompany = company.id;

    ids.leaderProfile = await insertTechnician('leader', { level: TechnicianLevel.PROFESSIONAL, hasLocation: true, companyId: ids.leaderCompany });
    const [leaderUserRow] = await q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.leaderProfile]);
    ids.leaderUser = leaderUserRow.user_id;

    ids.juniorProfile = await insertTechnician('junior', { level: TechnicianLevel.NEW, hasLocation: true });
    ids.seniorProfile = await insertTechnician('senior', { level: TechnicianLevel.PREMIUM, hasLocation: true });
    ids.blockedProfile = await insertTechnician('blocked', { level: TechnicianLevel.NEW, hasLocation: true });
    await blockToday(ids.blockedProfile);
    // عضو من نفس فريق/شركة القائد الدائم — لازم يظهر أولاً في listRecruitCandidates (أولوية، مش استبعاد).
    ids.teamMateProfile = await insertTechnician('teammate', { level: TechnicianLevel.VERIFIED, hasLocation: true, companyId: ids.leaderCompany });

    // فني بفئة مختلفة تمامًا (بلا technician_services ولا technician_categories لخدمة الاختبار) — لازم يتستبعد.
    const [wrongUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني فئة غلط ${runId}`,
    ]);
    users.push(wrongUser.id);
    const [wrongProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',1,'new','approved',true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [wrongUser.id, `TCRECWRONG${runId}`.slice(0, 20)],
    );
    ids.wrongCategoryProfile = wrongProfile.id;
    await q(`INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`, [
      ids.wrongCategoryProfile,
      otherService.id,
    ]);

    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
      {} as never, // settingsService
    );

    const assignmentGuard = new TechnicianAssignmentGuardService(settingsServiceStub);
    const workOpportunities = new TechnicianWorkOpportunitiesService(dataSource);

    orderTeamService = new OrderTeamService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderTeamMember),
      techniciansService,
      assignmentGuard,
      workOpportunities,
      settingsServiceStub,
      new EventEmitter2(),
    );

    ordersService = new OrdersService(
      dataSource.getRepository(Order),
      {} as never,
      {} as never,
      dataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      techniciansService,
      {} as never, // technicianCompaniesService
      {} as never, // scheduleService
      {} as never, // pricingEngineService
      {} as never, // promoCodesService
      {} as never, // buildingsService
      {} as never, // cancellationReasonsService
      {} as never, // walletsService
      {} as never, // settingsService
      {} as never, // paymentsService
      {} as never, // supportService
      new EventEmitter2(), // events
      orderTeamService,
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTREC-%`]);
      await q(`DELETE FROM order_team_members WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTREC-%`]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTREC-%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTREC-%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.blockedProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.juniorProfile, ids.seniorProfile, ids.blockedProfile, ids.teamMateProfile, ids.wrongCategoryProfile],
      ]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.juniorProfile, ids.seniorProfile, ids.blockedProfile, ids.teamMateProfile, ids.wrongCategoryProfile],
      ]);
      await q(`DELETE FROM technician_companies WHERE id = $1`, [ids.leaderCompany]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE category_id = ANY(SELECT id FROM service_categories WHERE name_en LIKE $1)`, [`%${runId}%`]);
      await q(`DELETE FROM service_categories WHERE name_en LIKE $1`, [`%${runId}%`]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('listRecruitCandidates — مرشّح رتبته أعلى من القائد بيتستبعد، الأقل/المطابق بيظهروا، فريق القائد الدائم أولاً', async () => {
    const orderId = await insertOrder(`list-${runId}`, { requiredTechnicians: 3 });
    const candidates = await orderTeamService.listRecruitCandidates(ids.leaderUser, orderId, 'technician');
    const candidateIds = candidates.map((c) => c.technicianId);

    expect(candidateIds).toContain(ids.juniorProfile); // new < professional (القائد)
    expect(candidateIds).not.toContain(ids.seniorProfile); // premium > professional
    expect(candidateIds).not.toContain(ids.blockedProfile); // حظر يوم صريح
    expect(candidateIds).not.toContain(ids.wrongCategoryProfile); // فئة مختلفة
    expect(candidateIds).not.toContain(ids.leaderProfile); // مش نفسه

    // أولوية فريق القائد الدائم (docs/08 §35 بند 2) — teamMateProfile أول عنصر في القايمة.
    expect(candidates[0].technicianId).toBe(ids.teamMateProfile);
    expect(candidates[0].isLeaderTeamMember).toBe(true);
    const junior = candidates.find((c) => c.technicianId === ids.juniorProfile);
    expect(junior?.isLeaderTeamMember).toBe(false);
    expect(junior?.capacityTier).toBe('LIGHT');
  });

  it('listRecruitCandidates — يرفض لو الدور المطلوب مكتمل بالفعل', async () => {
    const orderId = await insertOrder(`list-role-complete-${runId}`, { requiredTechnicians: 1, requiredAssistants: 0 });
    await expect(orderTeamService.listRecruitCandidates(ids.leaderUser, orderId, 'technician')).rejects.toThrow();
  });

  it('recruitMember — فني LIGHT بيتضاف فورًا، بلا فحص شركة خالص، ويطلق ORDER_CREW_CHANGED_EVENT بـaddedByType=technician', async () => {
    const orderId = await insertOrder(`recruit-ok-${runId}`, { requiredTechnicians: 3 });
    const handler = jest.fn();
    const events = (orderTeamService as unknown as { events: EventEmitter2 }).events;
    events.once(ORDER_CREW_CHANGED_EVENT, handler);

    const outcome = await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician', 'مساعد سباك');
    expect(outcome).toEqual({ status: 'added' });

    const rows = await q(`SELECT technician_id, role_label, added_by_technician_id, member_type FROM order_team_members WHERE order_id = $1`, [
      orderId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].technician_id).toBe(ids.juniorProfile);
    expect(rows[0].role_label).toBe('مساعد سباك');
    expect(rows[0].added_by_technician_id).toBe(ids.leaderProfile);
    expect(rows[0].member_type).toBe('team_member');

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as OrderCrewChangedEvent;
    expect(event).toMatchObject({ orderId, changeType: 'added', addedTechnicianProfileId: ids.juniorProfile, addedByType: 'technician' });
  });

  it('recruitMember — دور "assistant" بيتخزن member_type=assistant، role_label الافتراضي "مساعد"', async () => {
    const orderId = await insertOrder(`recruit-assistant-${runId}`, { requiredTechnicians: 1, requiredAssistants: 2 });
    const outcome = await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'assistant');
    expect(outcome).toEqual({ status: 'added' });
    const [row] = await q(`SELECT member_type, role_label FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(row.member_type).toBe('assistant');
    expect(row.role_label).toBe('مساعد');
  });

  it('recruitMember — role_label اختياري، بيرجع "عضو فريق" لدور technician لو مبعوتش', async () => {
    const orderId = await insertOrder(`recruit-default-role-${runId}`, { requiredTechnicians: 3 });
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician');
    const [row] = await q(`SELECT role_label FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(row.role_label).toBe('عضو فريق');
  });

  it('recruitMember — يرفض تجنيد فني رتبته أعلى من القائد', async () => {
    const orderId = await insertOrder(`recruit-higher-rank-${runId}`, { requiredTechnicians: 3 });
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.seniorProfile, 'technician')).rejects.toThrow();
    const rows = await q(`SELECT id FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(rows).toHaveLength(0);
  });

  it('recruitMember — يرفض فني حظر اليوم بنفسه (BLOCKED الحقيقي، مش is_available القديم)', async () => {
    const orderId = await insertOrder(`recruit-blocked-${runId}`, { requiredTechnicians: 3 });
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.blockedProfile, 'technician')).rejects.toThrow();
    const rows = await q(`SELECT id FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(rows).toHaveLength(0);
  });

  it('recruitMember — يرفض تجنيد القائد نفسه', async () => {
    const orderId = await insertOrder(`recruit-self-${runId}`, { requiredTechnicians: 3 });
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.leaderProfile, 'technician')).rejects.toThrow();
  });

  it('recruitMember — يرفض فني مضاف بالفعل (تعارض)', async () => {
    const orderId = await insertOrder(`recruit-dup-${runId}`, { requiredTechnicians: 3 });
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician');
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician')).rejects.toThrow();
  });

  it('recruitMember — فني MEANINGFUL/HEAVY بيتعرضله فرصة اختيارية بدل تحميل صامت (docs/08 §35 بند 3)', async () => {
    const orderId = await insertOrder(`recruit-meaningful-${runId}`, { requiredTechnicians: 3 });
    // نشغّل الجونيور بشغلانة مؤكدة تانية نفس اليوم (ASAP، بلا scheduled_at) — يبقى MEANINGFUL على الأقل.
    const [busyOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',10000,0,'individual') RETURNING id`,
      [`TESTREC-busy-${runId}`.slice(0, 24), ids.customerProfile, ids.juniorProfile, ids.service, ids.address, ids.zone],
    );

    const outcome = await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician');
    expect(outcome.status).toBe('offer_sent');
    if (outcome.status === 'offer_sent') {
      expect(['MEANINGFUL', 'HEAVY']).toContain(outcome.capacityTier);
    }
    const memberRows = await q(`SELECT id FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(memberRows).toHaveLength(0); // صفر تحميل صامت — لسه محتاج قبول صريح

    const [opp] = await q(`SELECT context, crew_role, status FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`, [
      orderId,
      ids.juniorProfile,
    ]);
    expect(opp).toMatchObject({ context: 'crew_recruit', crew_role: 'technician', status: 'offered' });

    await q(`DELETE FROM orders WHERE id = $1`, [busyOrder.id]);
  });

  it('getCrewComposition — فني/مساعد منفصلين، required_assistants متجاهلش خالص (بَقّة §35 المُصلّحة)', async () => {
    const orderId = await insertOrder(`composition-${runId}`, { requiredTechnicians: 3, requiredAssistants: 2 });
    const order = { requiredTechnicians: 3, requiredAssistants: 2 };
    const before = await orderTeamService.getCrewComposition(orderId, order);
    expect(before).toMatchObject({
      requiredTechnicians: 3,
      requiredAssistants: 2,
      assignedTechnicians: 1, // القائد بس
      assignedAssistants: 0,
      missingTechnicians: 2,
      missingAssistants: 2,
      crewComplete: false,
    });

    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'assistant');
    const afterAssistant = await orderTeamService.getCrewComposition(orderId, order);
    expect(afterAssistant).toMatchObject({ assignedAssistants: 1, missingAssistants: 1, assignedTechnicians: 1, missingTechnicians: 2 });
  });

  it('findVisibleForTechnician — عضو الفريق المُضاف يقدر يشوف تفاصيل الطلب دلوقتي (بَقّة حقيقية اتصلحت)', async () => {
    const orderId = await insertOrder(`visible-${runId}`, { requiredTechnicians: 3 });
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician');
    const [juniorUserRow] = await q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.juniorProfile]);

    const visible = await ordersService.findVisibleForTechnician(juniorUserRow.user_id, orderId);
    expect(visible.id).toBe(orderId);
  });

  it('findVisibleForTechnician — فني غريب (مش قائد ولا عضو) لسه بيترفض 404', async () => {
    const orderId = await insertOrder(`not-visible-${runId}`, { requiredTechnicians: 3 });
    const [seniorUserRow] = await q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.seniorProfile]);
    await expect(ordersService.findVisibleForTechnician(seniorUserRow.user_id, orderId)).rejects.toThrow();
  });

  it('listTeamAssignedForTechnician — "شغلي كعضو فريق" بيرجّع الطلب اللي هو مضاف ليه بس، مش طلبات هو قائدها', async () => {
    const orderId = await insertOrder(`team-assigned-${runId}`, { requiredTechnicians: 3 });
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician');
    // insertOrder() بيزرع الطلب بـtechnician_assigned افتراضيًا (مقبول لباقي اختبارات الملف
    // اللي مش شايفة حالة الطلب أصلاً) — بس listTeamAssignedForTechnician() بتفلتر على
    // ACTIVE_TECHNICIAN_ORDER_STATUSES (نفس شرط findActiveForTechnician() بالحرف)، واللي مش
    // شاملة technician_assigned (حالة "قبل القبول" — راجع order-state-machine.ts). لازم القبول
    // الفعلي يحصل الأول عشان الطلب يبان في القايمة دي، بالظبط زي أي طلب حقيقي.
    await q(`UPDATE orders SET order_status = 'accepted' WHERE id = $1`, [orderId]);
    const [juniorUserRow] = await q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.juniorProfile]);

    const assigned = await ordersService.listTeamAssignedForTechnician(juniorUserRow.user_id);
    expect(assigned.map((o) => o.id)).toContain(orderId);

    const leaderAssigned = await ordersService.listTeamAssignedForTechnician(ids.leaderUser);
    expect(leaderAssigned.map((o) => o.id)).not.toContain(orderId); // القائد ده technician_id مش عضو فريق
  });

  it('OrdersService.start() — بوابة اكتمال الطاقم: يرفض بدء الشغل لو الطاقم ناقص، ينجح لما يكتمل (docs/08 §35 بند 4)', async () => {
    const orderId = await insertOrder(`start-gate-${runId}`, { requiredTechnicians: 2, requiredAssistants: 0 });
    await q(`UPDATE orders SET order_status = 'technician_arrived' WHERE id = $1`, [orderId]);

    await expect(ordersService.start(ids.leaderUser, orderId)).rejects.toThrow(/الطاقم لسه ناقص/);

    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'technician');
    const started = await ordersService.start(ids.leaderUser, orderId);
    expect(started.orderStatus).toBe('in_progress');
  });
});
