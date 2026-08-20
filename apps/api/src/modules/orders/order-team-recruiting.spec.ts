import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrderTeamService } from './order-team.service';
import { OrdersService } from './orders.service';
import { Order, BookingMode } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { User } from '../auth/entities/user.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile, TechnicianLevel, TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { ORDER_CREW_CHANGED_EVENT, OrderCrewChangedEvent } from '../../common/events/order-crew-changed.event';

// اختبار حي ضد Postgres حقيقي — تجنيد فريق ميداني ذاتي من الفني القائد (docs/08 §31، طلب صريح
// من المالك 2026-08-20). مختلف عمدًا عن admin-crew-management.spec.ts: هنا القائد نفسه هو المُجنِّد
// (مش أدمن)، بلا قيد الشركة، مع فحص رتبة (TechnicianLevel) صريح.
describe('OrderTeamService — تجنيد فريق ذاتي من الفني القائد (docs/08 §31)', () => {
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
    juniorProfile: '',
    seniorProfile: '',
    unavailableProfile: '',
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
    opts: { level: TechnicianLevel; isAvailable: boolean; hasLocation: boolean; categoryId?: string },
  ) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',3,$3,'approved',$4, ${opts.hasLocation ? "ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography" : 'NULL'})
       RETURNING id`,
      [user.id, `TCREC${label}${runId}`.slice(0, 20), opts.level, opts.isAvailable],
    );
    const profileId = profile.id as string;
    await q(
      `INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`,
      [profileId, ids.service],
    );
    return profileId;
  }

  async function insertOrder(label: string, opts: { requiredTechnicians: number | null }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','pending',30000,0,'team',$7) RETURNING id`,
      [`TESTREC-${label}`.slice(0, 24), ids.customerProfile, ids.leaderProfile, ids.service, ids.address, ids.zone, opts.requiredTechnicians],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderTeamMember, User, TechnicianProfile, TechnicianCompany],
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

    ids.leaderProfile = await insertTechnician('leader', { level: TechnicianLevel.PROFESSIONAL, isAvailable: true, hasLocation: true });
    const [leaderUserRow] = await q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.leaderProfile]);
    ids.leaderUser = leaderUserRow.user_id;

    ids.juniorProfile = await insertTechnician('junior', { level: TechnicianLevel.NEW, isAvailable: true, hasLocation: true });
    ids.seniorProfile = await insertTechnician('senior', { level: TechnicianLevel.PREMIUM, isAvailable: true, hasLocation: true });
    ids.unavailableProfile = await insertTechnician('unavailable', { level: TechnicianLevel.NEW, isAvailable: false, hasLocation: true });

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

    orderTeamService = new OrderTeamService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderTeamMember),
      techniciansService,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new EventEmitter2(),
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_team_members WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTREC-%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTREC-%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.juniorProfile, ids.seniorProfile, ids.unavailableProfile, ids.wrongCategoryProfile],
      ]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [
        [ids.leaderProfile, ids.juniorProfile, ids.seniorProfile, ids.unavailableProfile, ids.wrongCategoryProfile],
      ]);
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

  it('listRecruitCandidates — مرشّح رتبته أعلى من القائد بيتستبعد، الأقل/المطابق ورتبة "new" الافتراضية بيظهروا', async () => {
    const orderId = await insertOrder(`list-${runId}`, { requiredTechnicians: 3 });
    const candidates = await orderTeamService.listRecruitCandidates(ids.leaderUser, orderId);
    const candidateIds = candidates.map((c) => c.technicianId);

    expect(candidateIds).toContain(ids.juniorProfile); // new < professional (القائد)
    expect(candidateIds).not.toContain(ids.seniorProfile); // premium > professional
    expect(candidateIds).not.toContain(ids.unavailableProfile); // is_available=false
    expect(candidateIds).not.toContain(ids.wrongCategoryProfile); // فئة مختلفة
    expect(candidateIds).not.toContain(ids.leaderProfile); // مش نفسه
  });

  it('recruitMember — تجنيد فوري ناجح، بلا فحص شركة خالص، ويطلق ORDER_CREW_CHANGED_EVENT بـaddedByType=technician', async () => {
    const orderId = await insertOrder(`recruit-ok-${runId}`, { requiredTechnicians: 3 });
    const handler = jest.fn();
    const events = (orderTeamService as unknown as { events: EventEmitter2 }).events;
    events.once(ORDER_CREW_CHANGED_EVENT, handler);

    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile, 'مساعد سباك');

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

  it('recruitMember — role_label اختياري، بيرجع "عضو فريق" لو مبعوتش', async () => {
    const orderId = await insertOrder(`recruit-default-role-${runId}`, { requiredTechnicians: 3 });
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile);
    const [row] = await q(`SELECT role_label FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(row.role_label).toBe('عضو فريق');
  });

  it('recruitMember — يرفض تجنيد فني رتبته أعلى من القائد', async () => {
    const orderId = await insertOrder(`recruit-higher-rank-${runId}`, { requiredTechnicians: 3 });
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.seniorProfile)).rejects.toThrow();
    const rows = await q(`SELECT id FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(rows).toHaveLength(0);
  });

  it('recruitMember — يرفض فني مش متاح دلوقتي', async () => {
    const orderId = await insertOrder(`recruit-unavailable-${runId}`, { requiredTechnicians: 3 });
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.unavailableProfile)).rejects.toThrow();
  });

  it('recruitMember — يرفض تجنيد القائد نفسه', async () => {
    const orderId = await insertOrder(`recruit-self-${runId}`, { requiredTechnicians: 3 });
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.leaderProfile)).rejects.toThrow();
  });

  it('recruitMember — يرفض فني مضاف بالفعل (تعارض)', async () => {
    const orderId = await insertOrder(`recruit-dup-${runId}`, { requiredTechnicians: 3 });
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile);
    await expect(orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile)).rejects.toThrow();
  });

  it('getShortageForOrder — الفريق ناقص لحد ما العدد يوصل required_technicians (+1 القائد)', async () => {
    const orderId = await insertOrder(`shortage-${runId}`, { requiredTechnicians: 3 });
    const before = await orderTeamService.getShortageForOrder(orderId, 3);
    expect(before).toEqual({ shortage: true, needed: 2 }); // leader بس = 1، محتاج 2 كمان

    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile);
    const afterOne = await orderTeamService.getShortageForOrder(orderId, 3);
    expect(afterOne).toEqual({ shortage: true, needed: 1 });
  });

  it('findVisibleForTechnician — عضو الفريق المُضاف يقدر يشوف تفاصيل الطلب دلوقتي (بَقّة حقيقية اتصلحت)', async () => {
    const orderId = await insertOrder(`visible-${runId}`, { requiredTechnicians: 3 });
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile);
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
    await orderTeamService.recruitMember(ids.leaderUser, orderId, ids.juniorProfile);
    const [juniorUserRow] = await q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.juniorProfile]);

    const assigned = await ordersService.listTeamAssignedForTechnician(juniorUserRow.user_id);
    expect(assigned.map((o) => o.id)).toContain(orderId);

    const leaderAssigned = await ordersService.listTeamAssignedForTechnician(ids.leaderUser);
    expect(leaderAssigned.map((o) => o.id)).not.toContain(orderId); // القائد ده technician_id مش عضو فريق
  });
});
