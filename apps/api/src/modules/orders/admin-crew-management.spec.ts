import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { AdminOrdersService } from './admin-orders.service';
import { Order, BookingMode } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { MAX_TEAM_MEMBERS_PER_ORDER } from './order-team.service';
import { User } from '../auth/entities/user.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile, TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { ORDER_CREW_CHANGED_EVENT } from '../../common/events/order-crew-changed.event';

// اختبار حي ضد Postgres حقيقي — إدارة طاقم الطلب من الأدمن (Script 4 §22-29, §38-41).
// كانت فجوة موثّقة صراحة: مفيش أي مسار أدمن لإدارة أعضاء الطاقم العاديين قبل migration 0132.
describe('AdminOrdersService — إدارة طاقم الطلب (crew editing)', () => {
  let dataSource: DataSource;
  let adminOrdersService: AdminOrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    zone: '',
    city: '',
    country: '',
    service: '',
    customerProfile: '',
    address: '',
    adminUserId: '',
    company: '',
    otherCompany: '',
    leaderProfile: '',
    memberAProfile: '',
    memberBProfile: '',
    unapprovedProfile: '',
    otherCompanyProfile: '',
  };
  const users: string[] = [];
  let phoneCounter = 0;
  // رقم قصير مضمون التفرّد جوّه الملف ده (عداد تصاعدي) — الاعتماد على تركيب label بالنص كان
  // بيتقطع عند 15 خانة ويسبب تصادم حقيقي بين "membera"/"memberb" (بَقّة اتلقطت واتصلحت هنا).
  function nextPhone(): string {
    const counter = (phoneCounter++).toString().padStart(2, '0');
    return `+2039${runId.slice(-6)}${counter}`.slice(0, 15);
  }

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertTechnician(label: string, opts: { companyId: string | null; verificationStatus: TechnicianVerificationStatus }) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, company_id, verification_status)
       VALUES ($1,$2,'x',3,'new',$3,$4) RETURNING id`,
      [user.id, `TCCRW${label}${runId}`.slice(0, 20), opts.companyId, opts.verificationStatus],
    );
    return profile.id as string;
  }

  async function insertOrder(label: string, opts: { bookingMode: BookingMode; technicianId: string; requiredTechnicians: number | null }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','pending',30000,0,$7,$8) RETURNING id`,
      [`TESTCRW-${label}`.slice(0, 24), ids.customerProfile, opts.technicianId, ids.service, ids.address, ids.zone, opts.bookingMode, opts.requiredTechnicians],
    );
    return order.id as string;
  }

  async function addMember(orderId: string, technicianId: string, roleLabel = 'مساعد') {
    await q(`INSERT INTO order_team_members (order_id, technician_id, role_label, added_by_admin_user_id) VALUES ($1,$2,$3,$4)`, [
      orderId,
      technicianId,
      roleLabel,
      ids.adminUserId,
    ]);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation, User, TechnicianProfile, TechnicianCompany],
    });
    await dataSource.initialize();

    // نطاق خدمة خاص بالملف ده، مش "SELECT ... LIMIT 1" مقترَض من أي صف موجود — ده كان بيسبب سباق
    // حقيقي على CI (قاعدة بيانات فاضية، ملفات jest تانية بتنشئ نطاقها وتحذفه في afterAll بتاعها،
    // فـ"أول نطاق موجود" ممكن يبقى نطاق ملف تاني بيتحذف قبل ما نخلص، وDELETE بتاعه يفشل بـFK
    // violation من أوردرات الملف ده اللي لسه موجودة).
    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة طاقم ${runId}`, `Crew Country ${runId}`, 'W' + runId.slice(0, 1).toUpperCase(), '+000', 'EGP'],
    );
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة طاقم ${runId}`,
      `Crew City ${runId}`,
      `test-crew-city-${runId}`,
    ]);
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق طاقم ${runId}`,
      `Crew Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    ids.city = city.id;
    ids.country = country.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة طاقم ${runId}`,
      `Crew Category ${runId}`,
      `test-crew-category-${runId}`,
    ]);
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [category.id, `خدمة طاقم ${runId}`, `test-crew-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2034${runId}`.slice(0, 15),
      `عميل طاقم ${runId}`,
      `customer-crw-${runId}@test.local`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع طاقم ${runId}`],
    );
    ids.address = address.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2035${runId}`.slice(0, 15),
      `أدمن اختبار ${runId}`,
    ]);
    users.push(adminUser.id);
    ids.adminUserId = adminUser.id;

    const [company] = await q(`INSERT INTO technician_companies (owner_user_id, name) VALUES ($1,$2) RETURNING id`, [
      adminUser.id, // مش لازم يكون نفس اليوزر منطقيًا بس مقبول لغرض الاختبار (FK بس على users.id)
      `شركة طاقم ${runId}`,
    ]);
    ids.company = company.id;

    ids.leaderProfile = await insertTechnician('leader', { companyId: ids.company, verificationStatus: TechnicianVerificationStatus.APPROVED });
    ids.memberAProfile = await insertTechnician('membera', { companyId: ids.company, verificationStatus: TechnicianVerificationStatus.APPROVED });
    ids.memberBProfile = await insertTechnician('memberb', { companyId: ids.company, verificationStatus: TechnicianVerificationStatus.APPROVED });
    ids.unapprovedProfile = await insertTechnician('unapproved', { companyId: ids.company, verificationStatus: TechnicianVerificationStatus.PENDING });
    ids.otherCompanyProfile = await insertTechnician('othercompany', { companyId: null, verificationStatus: TechnicianVerificationStatus.APPROVED });

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

    adminOrdersService = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      techniciansService,
      {} as never, // assignmentGuard — مش متنادى في مسارات الطاقم
      new EventEmitter2(),
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never, // pricingEngineService
      {} as never, // promoCodesService
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_team_members WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCRW-%`]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCRW-%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTCRW-%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      // بما فيهم فنيي الحشو الـ15 اللي اتضافوا جوّه اختبار "أقصى عدد" (كلهم company_id=ids.company)
      // — مش بس الخمسة الأساسيين، وإلا FK هيمنع مسح الشركة تحتهم.
      await q(`DELETE FROM technician_profiles WHERE id = $1 OR company_id = $2`, [ids.otherCompanyProfile, ids.company]);
      await q(`DELETE FROM technician_companies WHERE id = $1`, [ids.company]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('addCrewMember — إضافة عضو طاقم بنجاح لطلب "اعتماد" (فريق)', async () => {
    const orderId = await insertOrder(`add-ok-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.memberAProfile, 'سباك مساعد');

    const rows = await q(`SELECT technician_id, role_label, added_by_admin_user_id FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].technician_id).toBe(ids.memberAProfile);
    expect(rows[0].added_by_admin_user_id).toBe(ids.adminUserId);
  });

  it('addCrewMember — يرفض لو الطلب مش "اعتماد" (فريق)', async () => {
    const orderId = await insertOrder(`add-notteam-${runId}`, { bookingMode: BookingMode.INDIVIDUAL, technicianId: ids.leaderProfile, requiredTechnicians: null });
    await expect(adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.memberAProfile, 'دور')).rejects.toThrow();
  });

  it('addCrewMember — يرفض فني لسه مش معتمد', async () => {
    const orderId = await insertOrder(`add-unapproved-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await expect(adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.unapprovedProfile, 'دور')).rejects.toThrow();
  });

  it('addCrewMember — يرفض لو الفني هو نفسه قائد الطلب بالفعل', async () => {
    const orderId = await insertOrder(`add-leader-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await expect(adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.leaderProfile, 'دور')).rejects.toThrow();
  });

  it('addCrewMember — يرفض لو الفني مضاف بالفعل (تعارض)', async () => {
    const orderId = await insertOrder(`add-dup-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.memberAProfile, 'دور');
    await expect(adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.memberAProfile, 'دور تاني')).rejects.toThrow();
  });

  it('addCrewMember — يرفض تجاوز أقصى عدد أعضاء الفريق', async () => {
    const orderId = await insertOrder(`add-max-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    for (let i = 0; i < MAX_TEAM_MEMBERS_PER_ORDER; i++) {
      const [tmpUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        nextPhone(),
        `فني حشو ${i} ${runId}`,
      ]);
      users.push(tmpUser.id);
      const [tmpProfile] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, company_id, verification_status)
         VALUES ($1,$2,'x',1,'new',$3,$4) RETURNING id`,
        [tmpUser.id, `TCFILL${i}${runId}`.slice(0, 20), ids.company, TechnicianVerificationStatus.APPROVED],
      );
      await addMember(orderId, tmpProfile.id);
    }
    await expect(adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.memberAProfile, 'دور')).rejects.toThrow();
  });

  it('removeCrewMember — إزالة ناجحة، وبيرجع crewShortage=false لو العدد كافي بعد الإزالة', async () => {
    // required=2: leader + memberB = 2 بعد شيل memberA → كافي، صفر shortage.
    const orderId = await insertOrder(`remove-ok-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 2 });
    await addMember(orderId, ids.memberAProfile);
    await addMember(orderId, ids.memberBProfile);
    const [member] = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.memberAProfile]);

    const result = await adminOrdersService.removeCrewMember(ids.adminUserId, orderId, member.id, 'الفني اعتذر آخر لحظة');
    expect(result.crewShortage).toBe(false);
  });

  it('removeCrewMember — بيرجع crewShortage=true لو العدد بعد الإزالة أقل من المطلوب', async () => {
    const orderId = await insertOrder(`remove-shortage-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await addMember(orderId, ids.memberAProfile);
    await addMember(orderId, ids.memberBProfile);
    // leader + memberA + memberB = 3 = required، مفيش shortage قبل الإزالة
    const [member] = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.memberAProfile]);

    const result = await adminOrdersService.removeCrewMember(ids.adminUserId, orderId, member.id, 'الفني اعتذر آخر لحظة');
    // بعد الإزالة: leader + memberB = 2 < 3 = required → shortage
    expect(result.crewShortage).toBe(true);

    const remaining = await q(`SELECT technician_id FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].technician_id).toBe(ids.memberBProfile);
  });

  it('removeCrewMember — يرفض عضو غير موجود', async () => {
    const orderId = await insertOrder(`remove-notfound-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await expect(adminOrdersService.removeCrewMember(ids.adminUserId, orderId, '00000000-0000-0000-0000-000000000000', 'سبب')).rejects.toThrow();
  });

  it('replaceCrewMember — استبدال ذرّي ناجح، بياخد نفس role_label لو مفيش override', async () => {
    const orderId = await insertOrder(`replace-ok-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await addMember(orderId, ids.memberAProfile, 'كهربائي مساعد');
    const [member] = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.memberAProfile]);

    await adminOrdersService.replaceCrewMember(ids.adminUserId, orderId, member.id, ids.memberBProfile, 'الفني الأصلي مريض', undefined);

    const rows = await q(`SELECT technician_id, role_label FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].technician_id).toBe(ids.memberBProfile);
    expect(rows[0].role_label).toBe('كهربائي مساعد');
  });

  it('replaceCrewMember — بياخد role_label الجديد لو اتبعت override', async () => {
    const orderId = await insertOrder(`replace-override-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await addMember(orderId, ids.memberAProfile, 'دور قديم');
    const [member] = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.memberAProfile]);

    await adminOrdersService.replaceCrewMember(ids.adminUserId, orderId, member.id, ids.memberBProfile, 'سبب', 'دور جديد');

    const rows = await q(`SELECT role_label FROM order_team_members WHERE order_id = $1`, [orderId]);
    expect(rows[0].role_label).toBe('دور جديد');
  });

  it('replaceCrewMember — يرفض لو الفني الجديد نفس الفني القديم', async () => {
    const orderId = await insertOrder(`replace-same-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await addMember(orderId, ids.memberAProfile);
    const [member] = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.memberAProfile]);

    await expect(
      adminOrdersService.replaceCrewMember(ids.adminUserId, orderId, member.id, ids.memberAProfile, 'سبب', undefined),
    ).rejects.toThrow();
  });

  it('replaceCrewMember — يرفض عضو غير موجود', async () => {
    const orderId = await insertOrder(`replace-notfound-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    await expect(
      adminOrdersService.replaceCrewMember(ids.adminUserId, orderId, '00000000-0000-0000-0000-000000000000', ids.memberBProfile, 'سبب', undefined),
    ).rejects.toThrow();
  });

  it('addCrewMember — يطلق حدث order.crew_changed بعد الإضافة', async () => {
    const orderId = await insertOrder(`event-${runId}`, { bookingMode: BookingMode.TEAM, technicianId: ids.leaderProfile, requiredTechnicians: 3 });
    const events = (adminOrdersService as unknown as { events: EventEmitter2 }).events;
    const handler = jest.fn();
    events.once(ORDER_CREW_CHANGED_EVENT, handler);

    await adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.memberAProfile, 'دور');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ orderId, changeType: 'added', addedTechnicianProfileId: ids.memberAProfile });
  });
});
