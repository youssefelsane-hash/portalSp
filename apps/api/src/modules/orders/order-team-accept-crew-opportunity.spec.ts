import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrderTeamService } from './order-team.service';
import { Order, BookingMode } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { User } from '../auth/entities/user.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile, TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { SettingsService } from '../settings/settings.service';

// اختبار حي ضد Postgres حقيقي — §35.19: أمان التزامن لقبول فرصة تجنيد فريق (acceptCrewOpportunity()).
// الآلية نفسها (قفل pessimistic_write على الطلب + إعادة فحص composition/الأهلية تحت القفل) موجودة
// فعلاً في order-team.service.ts من وقت بناء §35 نفسه (تعليق الدالة بيشاور صراحة على docs/08 §35
// سيناريو L)، بس **مفيش أي اختبار حي كان بيثبتها** — order-team-recruiting.spec.ts بيغطي
// recruitMember()/listRecruitCandidates() بس، صفر تغطية لـacceptCrewOpportunity() خالص. ده الفجوة
// اللي §35.19 بيقفلها: إثبات حي إن (أ) منع تجاوز العدد المطلوب شغال فعلاً لو أكتر من فرصة اتقبلت
// بالتوازي، و(ب) إعادة فحص القدرة الاستيعابية وقت القبول (مش وقت العرض) شغالة فعلاً.
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback, getBoolean: async (_key: string, fallback: boolean) => fallback } as unknown as SettingsService;

describe('OrderTeamService.acceptCrewOpportunity() — أمان التزامن (docs/08 §35.19، سيناريو L)', () => {
  let dataSource: DataSource;
  let orderTeamService: OrderTeamService;
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
    candidateAProfile: '',
    candidateAUser: '',
    candidateBProfile: '',
    candidateBUser: '',
    soloProfile: '',
    soloUser: '',
  };
  const users: string[] = [];
  let phoneCounter = 0;

  function nextPhone(): string {
    const counter = (phoneCounter++).toString().padStart(2, '0');
    return `+2043${runId.slice(-6)}${counter}`.slice(0, 15);
  }

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertTechnician(label: string) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني قبول ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',3,'professional','approved',true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [user.id, `TCACC${label}${runId}`.slice(0, 20)],
    );
    const profileId = profile.id as string;
    await q(`INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`, [
      profileId,
      ids.service,
    ]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profileId, ids.zone]);
    return { profileId, userId: user.id as string };
  }

  async function insertOrder(label: string, requiredTechnicians: number) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians, required_assistants)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','pending',30000,0,'team',$7,0) RETURNING id`,
      [`TESTACC-${label}`.slice(0, 24), ids.customerProfile, ids.leaderProfile, ids.service, ids.address, ids.zone, requiredTechnicians],
    );
    return order.id as string;
  }

  async function insertOffer(orderId: string, technicianId: string) {
    const [row] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status, context, crew_role)
       VALUES ($1,$2,'MEANINGFUL','offered','crew_recruit','technician') RETURNING id`,
      [orderId, technicianId],
    );
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderTeamMember, User, TechnicianProfile, TechnicianCompany],
    });
    await dataSource.initialize();

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة قبول ${runId}`,
      `Accept City ${runId}`,
      `test-accept-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق قبول ${runId}`,
      `Accept Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة قبول ${runId}`,
      `Accept Category ${runId}`,
      `test-accept-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',30000,20,0,60) RETURNING id`,
      [ids.category, `خدمة قبول ${runId}`, `test-accept-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2042${runId}`.slice(0, 15),
      `عميل قبول ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع قبول ${runId}`],
    );
    ids.address = address.id;

    const leader = await insertTechnician('قائد');
    ids.leaderProfile = leader.profileId;
    ids.leaderUser = leader.userId;

    const candidateA = await insertTechnician('أ');
    ids.candidateAProfile = candidateA.profileId;
    ids.candidateAUser = candidateA.userId;
    const candidateB = await insertTechnician('ب');
    ids.candidateBProfile = candidateB.profileId;
    ids.candidateBUser = candidateB.userId;
    const solo = await insertTechnician('منفرد');
    ids.soloProfile = solo.profileId;
    ids.soloUser = solo.userId;

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
      {} as never,
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
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTACC-%`]);
      await q(`DELETE FROM order_team_members WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTACC-%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTACC-%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.candidateAProfile, ids.candidateBProfile, ids.soloProfile],
      ]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.candidateAProfile, ids.candidateBProfile, ids.soloProfile],
      ]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.candidateAProfile, ids.candidateBProfile, ids.soloProfile],
      ]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.candidateAProfile, ids.candidateBProfile, ids.soloProfile],
      ]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('قبول فرصة صحيح — بيضيف صف order_team_members ويعلّم الفرصة accepted', async () => {
    const orderId = await insertOrder('happy', 2);
    const opportunityId = await insertOffer(orderId, ids.soloProfile);

    const items = await orderTeamService.acceptCrewOpportunity(ids.soloUser, opportunityId);
    expect(items.some((i) => i.technicianId === ids.soloProfile)).toBe(true);

    const [opp] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [opportunityId]);
    expect(opp.status).toBe('accepted');
  });

  it('منع تجاوز العدد المطلوب — فرصتين اتقبلوا بالتوازي على مكان واحد بس، واحد بس يفوز (Scenario L)', async () => {
    // required_technicians=2 يعني قائد + عضو واحد بس ناقص (مكان واحد فاضي).
    const orderId = await insertOrder('race', 2);
    const oppA = await insertOffer(orderId, ids.candidateAProfile);
    const oppB = await insertOffer(orderId, ids.candidateBProfile);

    const results = await Promise.allSettled([
      orderTeamService.acceptCrewOpportunity(ids.candidateAUser, oppA),
      orderTeamService.acceptCrewOpportunity(ids.candidateBUser, oppB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // بالظبط عضو واحد اتضاف فعلاً — مفيش تجاوز للعدد المطلوب رغم إن الفرصتين كانوا offered بالتوازي.
    const members = await q(`SELECT technician_id FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(members).toHaveLength(1);
    expect([ids.candidateAProfile, ids.candidateBProfile]).toContain(members[0].technician_id);

    // الفرصة اللي خسرت اتعلّمت declined (مش فضلت offered معلّقة).
    const [winnerOppId, loserOppId] =
      members[0].technician_id === ids.candidateAProfile ? [oppA, oppB] : [oppB, oppA];
    const [winnerOpp] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [winnerOppId]);
    const [loserOpp] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [loserOppId]);
    expect(winnerOpp.status).toBe('accepted');
    expect(loserOpp.status).toBe('declined');
  });

  it('إعادة فحص القدرة الاستيعابية وقت القبول — الفني حظر اليوم بعد ما اتعرضت عليه الفرصة، القبول يترفض بوضوح', async () => {
    const orderId = await insertOrder('recheck', 2);
    const opportunityId = await insertOffer(orderId, ids.candidateAProfile);

    // الفني حظر اليوم بنفسه بعد ما الفرصة اتعرضت (وقت العرض كان متاح فعلاً) — العرض لسه offered
    // (ظاهر في الشاشة)، بس الحالة الحقيقية اتغيّرت. assertEligibleForWorkOpportunity() لازم يمنع
    // القبول بناءً على الحالة الحالية، مش الفرصة القديمة.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1,$2,'00:00:00','23:59:59','blocked')`,
      [ids.candidateAProfile, today],
    );

    await expect(orderTeamService.acceptCrewOpportunity(ids.candidateAUser, opportunityId)).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });

    const [opp] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [opportunityId]);
    expect(opp.status).toBe('offered'); // لسه offered — مترفضتش بـmarkDecided لأنها رفضت قبل فحص الاكتمال أصلاً
    const members = await q(`SELECT 1 FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [
      orderId,
      ids.candidateAProfile,
    ]);
    expect(members).toHaveLength(0);

    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.candidateAProfile]);
  });

  it('العدد مكتمل بالفعل وقت القبول (مش سباق، بس بعد إضافة يدوية سابقة) — يترفض ويعلّم الفرصة declined', async () => {
    const orderId = await insertOrder('already-full', 2);
    await q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, added_by_technician_id, member_type)
       VALUES ($1,$2,'عضو فريق',$3,'team_member')`,
      [orderId, ids.soloProfile, ids.leaderProfile],
    );
    const opportunityId = await insertOffer(orderId, ids.candidateAProfile);

    await expect(orderTeamService.acceptCrewOpportunity(ids.candidateAUser, opportunityId)).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });

    const [opp] = await q(`SELECT status FROM technician_work_opportunities WHERE id = $1`, [opportunityId]);
    expect(opp.status).toBe('declined');
  });
});
