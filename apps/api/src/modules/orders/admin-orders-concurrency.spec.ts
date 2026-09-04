import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { AdminOrdersService } from './admin-orders.service';
import { Order, BookingMode, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { User } from '../auth/entities/user.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { OrderAssignment } from '../matching/entities/order-assignment.entity';

// اختبار حي ضد Postgres حقيقي — تزامن عمليات الأدمن الجديدة (Script 4 Part Q). زوج سيناريوهات
// من الجدول المطلوب صراحة: "Two Admins reassign same order" و"Crew add × crew remove" (مقاربة
// أقرب: إضافة نفس الفني بالتوازي من أدمنين، النتيجة المتوقعة عضو واحد بس مش صف مكرر).
describe('AdminOrdersService — تزامن (Script 4 Part Q)', () => {
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
    adminUserA: '',
    adminUserB: '',
    leaderProfile: '',
    technicianAProfile: '',
    technicianBProfile: '',
    newLeaderCProfile: '',
    newLeaderDProfile: '',
    raceCrewProfile: '',
  };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function makeTechnician(label: string, opts: { companyId?: string | null; level?: string } = {}) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2047${runId}${label}`.slice(0, 15),
      `فني تزامن ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, is_on_duty, current_location, company_id)
       VALUES ($1,$2,'x',3,$4,'approved',true,true,ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,$3) RETURNING id`,
      [user.id, `TCCC${label}${runId}`.slice(0, 20), opts.companyId ?? null, opts.level ?? 'new'],
    );
    const profileId = profile.id as string;
    await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [profileId, ids.service]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profileId, ids.zone]);
    return profileId;
  }

  async function insertOrder(
    label: string,
    opts: { bookingMode: BookingMode; technicianId: string | null; orderStatus: OrderStatus },
  ) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',10000,0,$8) RETURNING id`,
      [`TESTCC-${label}`.slice(0, 24), ids.customerProfile, opts.technicianId, ids.service, ids.address, ids.zone, opts.orderStatus, opts.bookingMode],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation, User, TechnicianProfile, TechnicianCompany, OrderAssignment],
    });
    await dataSource.initialize();

    // نطاق خدمة خاص بالملف ده، مش "SELECT ... LIMIT 1" مقترَض (كان بيسبب سباق حقيقي مع ملفات
    // jest تانية بتنشئ نطاقها وتحذفه على CI — راجع نفس الإصلاح في admin-crew-management.spec.ts).
    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة تزامن ${runId}`,
      `Concurrency City ${runId}`,
      `test-cc-city-${runId}`,
    ]);
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق تزامن ${runId}`,
      `Concurrency Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    ids.city = city.id;
    ids.country = country.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تزامن ${runId}`,
      `Concurrency Category ${runId}`,
      `test-cc-cat-${runId}`,
    ]);
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
      [category.id, `خدمة تزامن ${runId}`, `test-cc-svc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2048${runId}`.slice(0, 15),
      `عميل تزامن ${runId}`,
      `customer-cc-${runId}@test.local`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تزامن ${runId}`],
    );
    ids.address = address.id;

    const [adminUserA] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2049${runId}A`.slice(0, 15),
      `أدمن تزامن أ ${runId}`,
    ]);
    users.push(adminUserA.id);
    ids.adminUserA = adminUserA.id;
    const [adminUserB] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2049${runId}B`.slice(0, 15),
      `أدمن تزامن ب ${runId}`,
    ]);
    users.push(adminUserB.id);
    ids.adminUserB = adminUserB.id;

    ids.leaderProfile = await makeTechnician('leader');
    ids.technicianAProfile = await makeTechnician('a');
    ids.technicianBProfile = await makeTechnician('b');
    // docs/08 §38 — بوابة "مستوى الفني مؤهّل يبقى قائد اعتماد" (technician_level_config.eligible_
    // for_team_booking) بقت جزء من assertCoreEligibility() المستخدمة في reassignLeader(). المستوى
    // الافتراضي 'new' هنا مش مؤهّل (مزروع false في migration 0158) — الاتنين دول بس هدفهم يبقوا
    // قائد فعلي فمحتاجين مستوى مؤهّل، عكس باقي فنيي الملف ده (عضوية/تعيين فردي مش قيادة اعتماد).
    ids.newLeaderCProfile = await makeTechnician('c', { level: 'professional' });
    ids.newLeaderDProfile = await makeTechnician('d', { level: 'professional' });

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
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb) } as never), // حقيقية — صفر stub، عشان نفس منطق الأهلية الفعلي يتنفّذ تحت السباق
      new EventEmitter2(),
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never, // pricingEngineService — مش متنادى في reassign/crew
      {} as never, // promoCodesService
      { getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb) } as never, // settingsService (docs/08 §35),
      {} as never, // walletsService (ADR-0051) — مش متنادى هنا
      new TechnicianWorkOpportunitiesService(dataSource),
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_team_members WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCC-%`]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCC-%`]);
      // ADR-0057 — addCrewMember بقت ممكن تنشئ صف technician_work_opportunities (المسار
      // "فرصة" لما القدرة الاستيعابية مش LIGHT)، فلازم يتنضّف قبل DELETE FROM orders وإلا الـFK
      // (technician_work_opportunities_order_id_fkey) بيرفض الحذف.
      await q(`DELETE FROM technician_work_opportunities WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCC-%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTCC-%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      const allTechnicians = [
        ids.leaderProfile,
        ids.technicianAProfile,
        ids.technicianBProfile,
        ids.newLeaderCProfile,
        ids.newLeaderDProfile,
        ids.raceCrewProfile,
      ];
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [allTechnicians]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [allTechnicians]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [allTechnicians]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('سباق حقيقي: أدمنين اتنين بيحاولوا يعيّنوا فنيين مختلفين لنفس الطلب بالتوازي — واحد بس ينجح', async () => {
    const orderId = await insertOrder(`reassign-race-${runId}`, {
      bookingMode: BookingMode.INDIVIDUAL,
      technicianId: null,
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
    });

    const results = await Promise.allSettled([
      adminOrdersService.reassign(ids.adminUserA, orderId, ids.technicianAProfile),
      adminOrdersService.reassign(ids.adminUserB, orderId, ids.technicianBProfile),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // الحالة النهائية في الداتابيز لازم تكون فني واحد بس (اللي فاز بالقفل)، مش الاتنين ولا صفر.
    const [finalOrder] = await q(`SELECT technician_id, order_status FROM orders WHERE id = $1`, [orderId]);
    expect([ids.technicianAProfile, ids.technicianBProfile]).toContain(finalOrder.technician_id);
    expect(finalOrder.order_status).toBe('accepted');

    // reassign() الناجح بيعدّي بمرحلتين (searching_technician→technician_assigned→accepted) في
    // نفس الترانزاكشن، فسطرين تاريخ متوقعين للفايز — مش سطر واحد. المهم إن الخاسر صفر سطور
    // (الترانزاكشن كامل اترجع بالكامل، مفيش أثر جزئي من المحاولة اللي فشلت).
    const history = await q(`SELECT count(*)::int AS c FROM order_status_history WHERE order_id = $1`, [orderId]);
    expect(history[0].c).toBe(2);
  });

  it('سباق حقيقي: أدمنين اتنين بيضيفوا نفس الفني لنفس الطلب بالتوازي — واحد بس ينجح، التاني يرجع 409 نضيف (مش 500 خام)', async () => {
    const orderId = await insertOrder(`crew-add-race-${runId}`, {
      bookingMode: BookingMode.TEAM,
      technicianId: ids.leaderProfile,
      orderStatus: OrderStatus.TECHNICIAN_ASSIGNED,
    });

    // ADR-0057 — technicianAProfile/B ممكن يكون عندهم بالفعل طلب فعّال النهاردة من اختبار
    // reassign() اللي فات (نفس الملف)، وده هيخلي addCrewMember يتحول لمسار "فرصة" (صحيح ومقصود)
    // بدل الإضافة الفورية. الاختبار ده تحديدًا بيفحص سباق INSERT المباشر (unique constraint)،
    // فمحتاج فني نضيف مفيهوش أي التزام تاني النهاردة — نفس ضمان LIGHT tier.
    ids.raceCrewProfile = await makeTechnician(`race-${runId}`);

    const results = await Promise.allSettled([
      adminOrdersService.addCrewMember(ids.adminUserA, orderId, ids.raceCrewProfile, 'دور أ'),
      adminOrdersService.addCrewMember(ids.adminUserB, orderId, ids.raceCrewProfile, 'دور ب'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    // مهم: الرفض لازم يكون رسالة ApiException نضيفة (409 "مضاف بالفعل") مش QueryFailedError خام
    // بتسرّب كـ500 — ده بالظبط الإصلاح اللي اتعمل في addCrewMember() (isUniqueViolation catch).
    expect(String(rejected[0].reason)).toContain('مضاف بالفعل');

    // صف واحد بس في order_team_members — الـUNIQUE constraint منع الصف المكرر فعليًا.
    const members = await q(`SELECT count(*)::int AS c FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [
      orderId,
      ids.raceCrewProfile,
    ]);
    expect(members[0].c).toBe(1);
  });

  // تغيير قائد الطلب (docs/08 §35، ADR-0021 §5) — كانت فجوة حقيقية: reassign() مقصورة على مرحلة
  // "قبل القبول"، مش تقدر تُستخدم لطلب فريق بعد ما القبول وتجميع الطاقم حصلوا بالفعل.
  it('reassignLeader — بينجح لطلب فريق مقبول، والقائد القديم بيتحوّل لعضو فريق عادي (تماسك الحالة، سيناريو I)', async () => {
    const orderId = await insertOrder(`reassign-leader-ok-${runId}`, {
      bookingMode: BookingMode.TEAM,
      technicianId: ids.leaderProfile,
      orderStatus: OrderStatus.ACCEPTED,
    });

    const updated = await adminOrdersService.reassignLeader(ids.adminUserA, orderId, ids.newLeaderCProfile, 'القائد الأصلي مش متاح');
    expect(updated.technicianId).toBe(ids.newLeaderCProfile);

    const [oldLeaderMember] = await q(`SELECT role_label, added_by_admin_user_id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [
      orderId,
      ids.leaderProfile,
    ]);
    expect(oldLeaderMember).toBeDefined();
    expect(oldLeaderMember.role_label).toBe('قائد سابق');
    expect(oldLeaderMember.added_by_admin_user_id).toBe(ids.adminUserA);
  });

  it('reassignLeader — لو القائد الجديد كان عضو فريق بالفعل، بيتشال من العضوية (بقى قائد مش عضو)', async () => {
    const orderId = await insertOrder(`reassign-leader-was-member-${runId}`, {
      bookingMode: BookingMode.TEAM,
      technicianId: ids.leaderProfile,
      orderStatus: OrderStatus.ACCEPTED,
    });
    await q(`INSERT INTO order_team_members (order_id, technician_id, role_label, added_by_admin_user_id) VALUES ($1,$2,$3,$4)`, [
      orderId,
      ids.newLeaderDProfile,
      'عضو فريق',
      ids.adminUserA,
    ]);

    const updated = await adminOrdersService.reassignLeader(ids.adminUserA, orderId, ids.newLeaderDProfile, 'ترقية لقائد');
    expect(updated.technicianId).toBe(ids.newLeaderDProfile);
    const [stillMember] = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.newLeaderDProfile]);
    expect(stillMember).toBeUndefined();
  });

  it('reassignLeader — يرفض لطلب فردي (مش "اعتماد")', async () => {
    const orderId = await insertOrder(`reassign-leader-notteam-${runId}`, {
      bookingMode: BookingMode.INDIVIDUAL,
      technicianId: ids.leaderProfile,
      orderStatus: OrderStatus.ACCEPTED,
    });
    await expect(adminOrdersService.reassignLeader(ids.adminUserA, orderId, ids.newLeaderCProfile, 'سبب')).rejects.toThrow();
  });

  it('reassignLeader — يرفض تعيين نفس القائد الحالي', async () => {
    const orderId = await insertOrder(`reassign-leader-same-${runId}`, {
      bookingMode: BookingMode.TEAM,
      technicianId: ids.leaderProfile,
      orderStatus: OrderStatus.ACCEPTED,
    });
    await expect(adminOrdersService.reassignLeader(ids.adminUserA, orderId, ids.leaderProfile, 'سبب')).rejects.toThrow();
  });

  it('سباق حقيقي: أدمنين اتنين بيحاولوا يغيّروا قائد نفس طلب الفريق لفنيين مختلفين بالتوازي — واحد بس ينجح', async () => {
    const orderId = await insertOrder(`reassign-leader-race-${runId}`, {
      bookingMode: BookingMode.TEAM,
      technicianId: ids.leaderProfile,
      orderStatus: OrderStatus.ACCEPTED,
    });

    const results = await Promise.allSettled([
      adminOrdersService.reassignLeader(ids.adminUserA, orderId, ids.newLeaderCProfile, 'سبب أ'),
      adminOrdersService.reassignLeader(ids.adminUserB, orderId, ids.newLeaderDProfile, 'سبب ب'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const [finalOrder] = await q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
    expect([ids.newLeaderCProfile, ids.newLeaderDProfile]).toContain(finalOrder.technician_id);

    // القائد الأصلي لازم يتحوّل لعضو فريق مرة واحدة بس — صفر صف مكرر من المحاولة اللي فشلت.
    const oldLeaderMembership = await q(`SELECT count(*)::int AS c FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [
      orderId,
      ids.leaderProfile,
    ]);
    expect(oldLeaderMembership[0].c).toBe(1);
  });
});
