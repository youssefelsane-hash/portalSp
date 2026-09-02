import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { AdminOrdersService } from '../orders/admin-orders.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderStatus } from '../orders/entities/order.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { AssignmentStatus, OrderAssignment } from './entities/order-assignment.entity';
import { MatchingService } from './matching.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

// اختبار تزامن حقيقي ضد Postgres حقيقي (docs/08 §17.16) — بيثبت إن قفل pessimistic_write على
// صف الطلب في MatchingService.accept() فعليًا بيمنع قبول مزدوج لنفس الطلب، مش بس افتراض من قراءة
// الكود. فنيين حقيقيين، Promise.all حقيقي — التاني لازم يترفض بـCONFLICT، الفني الأول بس اللي
// ياخد الطلب، وعرض الخاسر لازم يتلغي أوتوماتيك (مش يفضل SENT معلّق للأبد).
describe('MatchingService.accept() — قبول مزدوج متزامن (regression/security §17.16)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let matchingService: MatchingService;
  let adminOrdersService: AdminOrdersService;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    technicianAUser: '',
    technicianAProfile: '',
    technicianBUser: '',
    technicianBProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    order: '',
    assignmentA: '',
    assignmentB: '',
    adminUser: '',
  };
  const orderIds: string[] = [];

  async function insertOrder(
    label: string,
    technicianId?: string,
    status = OrderStatus.SEARCHING_TECHNICIAN,
    estimatedDurationDays?: number,
    scheduledAt?: Date,
    durationHours?: number,
  ): Promise<string> {
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status,
          total_amount_cents, estimated_duration_days, scheduled_at, duration_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,10000,$8,$9,$10) RETURNING id`,
      [
        `P7-${label}-${runId}`.slice(0, 24),
        ids.customerProfile,
        technicianId ?? null,
        ids.service,
        ids.address,
        ids.zone,
        status,
        estimatedDurationDays ?? null,
        scheduledAt ?? null,
        durationHours ?? null,
      ],
    );
    orderIds.push(order.id as string);
    return order.id as string;
  }

  async function insertAssignment(orderId: string, technicianId: string): Promise<string> {
    const [assignment] = await dataSource.query(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent',now(),now() + interval '2 minutes') RETURNING id`,
      [orderId, technicianId],
    );
    return assignment.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    // findByUserIdOrThrow/getOrThrow بس المُستخدمين فعليًا في accept() — باقي التبعيات مش لازمة هنا.
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never, // technicianServicesRepo
      {} as never, // servicesRepo
      {} as never, // usersRepo — مش متنادى في المسار المُختبر هنا
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // settingsService
    );
    const assignmentGuard = new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb) } as never);

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      assignmentGuard,
      {} as never,
      { emit: () => true } as never,
      { add: async () => undefined } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    adminOrdersService = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      {} as never,
      {} as never,
      dataSource,
      techniciansService,
      assignmentGuard,
      { emit: () => true } as never,
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never,
      {} as never,
      {} as never, // settingsService (docs/08 §35),
      {} as never, // walletsService (ADR-0051) — مش متنادى هنا
      {} as never, // workOpportunities (ADR-0057) — مش متنادى هنا
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-${runId}`],
    );
    ids.city = city.id;

    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق اختبار ${runId}`, `Test Zone ${runId}`],
    );
    ids.zone = zone.id;

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-${runId}`],
    );
    ids.category = category.id;

    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-${runId}`],
    );
    ids.service = service.id;

    const makeTechnician = async (label: string) => {
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
        [`+201${label}${runId}`.slice(0, 14), `فني اختبار ${label} ${runId}`],
      );
      const [profile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1,$2,'new','approved',true,true,ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `TST${label}${runId}`.slice(0, 20)],
      );
      return { userId: user.id as string, profileId: profile.id as string };
    };

    const techA = await makeTechnician('A');
    ids.technicianAUser = techA.userId;
    ids.technicianAProfile = techA.profileId;
    const techB = await makeTechnician('B');
    ids.technicianBUser = techB.userId;
    ids.technicianBProfile = techB.profileId;

    for (const technicianId of [ids.technicianAProfile, ids.technicianBProfile]) {
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [technicianId, ids.service]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [technicianId, ids.zone]);
    }

    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2028${runId}`.slice(0, 15), `أدمن تعيين ${runId}`],
    );
    ids.adminUser = adminUser.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2019${runId}`.slice(0, 14), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;

    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;

    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',10000) RETURNING id`,
      [`TEST-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;
    orderIds.push(ids.order);

    const expiresAt = new Date(Date.now() + 60_000);
    const [assignmentA] = await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent',now(),$3) RETURNING id`,
      [ids.order, ids.technicianAProfile, expiresAt],
    );
    ids.assignmentA = assignmentA.id;
    const [assignmentB] = await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent',now(),$3) RETURNING id`,
      [ids.order, ids.technicianBProfile, expiresAt],
    );
    ids.assignmentB = assignmentB.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [ids.technicianAProfile, ids.technicianBProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [ids.technicianAProfile, ids.technicianBProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.customerUser, ids.adminUser]);
      await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [ids.technicianAProfile, ids.technicianBProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.technicianAUser, ids.technicianBUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('فنيين اتنين بيقبلوا نفس الطلب في نفس اللحظة — واحد بس يفوز، التاني يترفض بـCONFLICT', async () => {
    const results = await Promise.allSettled([
      matchingService.accept(ids.technicianAUser, ids.order),
      matchingService.accept(ids.technicianBUser, ids.order),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason as { getStatus: () => number };
    expect(rejectedReason.getStatus()).toBe(409);

    const [order] = await dataSource.query(`SELECT technician_id, order_status FROM orders WHERE id = $1`, [ids.order]);
    expect([ids.technicianAProfile, ids.technicianBProfile]).toContain(order.technician_id);
    expect(order.order_status).toBe('accepted');

    const assignments = await dataSource.query(
      `SELECT id, technician_id, assignment_status FROM order_assignments WHERE order_id = $1 ORDER BY technician_id`,
      [ids.order],
    );
    const winnerAssignment = assignments.find((a: { technician_id: string }) => a.technician_id === order.technician_id);
    const loserAssignment = assignments.find((a: { technician_id: string }) => a.technician_id !== order.technician_id);
    expect(winnerAssignment.assignment_status).toBe(AssignmentStatus.ACCEPTED);
    // الخسارة لازم تتلغي أوتوماتيك — مش تفضل "sent" معلّقة للأبد (كانت هتخلي الفني الخاسر
    // يستنى رد على عرض راح فعلاً).
    expect(loserAssignment.assignment_status).toBe(AssignmentStatus.CANCELLED);
  });

  // ADR-0018 §5 (طلب صريح من المالك 2026-08-19) — عرض طوارئ لازم يفضل قابل للقبول طالما محدش
  // أخده، حتى لو مهلة الجولة (expires_at) فاتت من زمان. راجع matching-round-expiry.processor.ts:
  // مهلة الجولة بقت تريجر لتوسيع البث لفنيين إضافيين بس، مش ميعاد صلاحية للعرض نفسه.
  it('عرض طوارئ فات معاده (expires_at) لسه قابل للقبول طالما محدش أخده — ADR-0018 §5', async () => {
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id IN ($1,$2)
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianAProfile, ids.technicianBProfile],
    );
    const orderId = await insertOrder('expired-still-valid');
    const [assignment] = await dataSource.query(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent', now() - interval '5 minutes', now() - interval '4 minutes') RETURNING id`,
      [orderId, ids.technicianAProfile],
    );

    // العرض يفضل ظاهر في قايمة الفني رغم إن expires_at فات من زمان.
    const available = await matchingService.listAvailableForTechnician(ids.technicianAUser);
    expect(available.some((row) => row.order_id === orderId)).toBe(true);

    // القبول لازم ينجح رغم إن expires_at فات — العرض مش باطل لمجرد مرور الوقت، بس لسه محدش أخده.
    const order = await matchingService.accept(ids.technicianAUser, orderId);
    expect(order.orderStatus).toBe(OrderStatus.ACCEPTED);
    expect(order.technicianId).toBe(ids.technicianAProfile);

    const [updatedAssignment] = await dataSource.query(`SELECT assignment_status FROM order_assignments WHERE id = $1`, [
      assignment.id,
    ]);
    expect(updatedAssignment.assignment_status).toBe(AssignmentStatus.ACCEPTED);
  });

  it('نفس الفني يقبل طلبين مختلفين بالتوازي — مورد الفني المشترك يسمح بطلب نشط واحد', async () => {
    await dataSource.query(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [ids.order]);
    // تنضيف طلب الفني A النشط المتبقّي من اختبار "عرض طوارئ فات معاده" قبله (نفس نمط التنضيف
    // اللي اختبار "قبول فني × إعادة تعيين أدمن" بعده بيعمله) — من غيره technicianA بيدخل الاختبار
    // ده وهو أصلاً عنده طلب accepted من زمان، فالاتنين orderA/orderB يترفضوا بدل ما ينجح واحد بس.
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id IN ($1,$2)
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianAProfile, ids.technicianBProfile],
    );
    // docs/08 §32 — طلبين قصيرين (المدة الافتراضية) بقوا متوافقين قانونيًا لنفس الفني في نفس
    // اليوم (شغلانتين قصار)، فمابقاش "نجاح واحد بس" مؤشر صح لسلامة القفل. estimated_duration_days=1
    // (شاغل يوم كامل) بيرجّع التعارض الحقيقي اللي الاختبار ده قصده أصلاً — يثبت إن القفل بيمنع
    // نفس الفني يقبل طلبين متعارضين فعليًا بالتوازي، مش مجرد "طلبين" بشكل عام.
    const orderA = await insertOrder('same-tech-a', undefined, OrderStatus.SEARCHING_TECHNICIAN, 1);
    const orderB = await insertOrder('same-tech-b', undefined, OrderStatus.SEARCHING_TECHNICIAN, 1);
    await insertAssignment(orderA, ids.technicianAProfile);
    await insertAssignment(orderB, ids.technicianAProfile);

    const outcomes = await Promise.allSettled([
      matchingService.accept(ids.technicianAUser, orderA),
      matchingService.accept(ids.technicianAUser, orderB),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM orders
       WHERE technician_id = $1
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianAProfile],
    );
    expect(count).toBe(1);
  });

  it('طلبان بوقت دقيق متداخلان لنفس الفني: القفل يعيد الفحص وواحد فقط ينجح', async () => {
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id = $1
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianAProfile],
    );
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    start.setUTCHours(10, 0, 0, 0);
    const orderA = await insertOrder('precise-overlap-a', undefined, OrderStatus.SEARCHING_TECHNICIAN, undefined, start, 2);
    const orderB = await insertOrder('precise-overlap-b', undefined, OrderStatus.SEARCHING_TECHNICIAN, undefined, start, 2);
    await insertAssignment(orderA, ids.technicianAProfile);
    await insertAssignment(orderB, ids.technicianAProfile);

    const outcomes = await Promise.allSettled([
      matchingService.accept(ids.technicianAUser, orderA),
      matchingService.accept(ids.technicianAUser, orderB),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });

  it('موعدان دقيقان متجاوران لنفس الفني مسموحان: 10-12 ثم 12-14', async () => {
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id = $1
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianAProfile],
    );
    const firstStart = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    firstStart.setUTCHours(10, 0, 0, 0);
    const secondStart = new Date(firstStart.getTime() + 2 * 60 * 60 * 1000);
    const orderA = await insertOrder('precise-adjacent-a', undefined, OrderStatus.SEARCHING_TECHNICIAN, undefined, firstStart, 2);
    const orderB = await insertOrder('precise-adjacent-b', undefined, OrderStatus.SEARCHING_TECHNICIAN, undefined, secondStart, 2);
    await insertAssignment(orderA, ids.technicianAProfile);
    await insertAssignment(orderB, ids.technicianAProfile);

    await expect(matchingService.accept(ids.technicianAUser, orderA)).resolves.toMatchObject({ id: orderA });
    await expect(matchingService.accept(ids.technicianAUser, orderB)).resolves.toMatchObject({ id: orderB });
  });

  it('قبول فني × إعادة تعيين أدمن: المؤشر والعرض المقبول ينتميان لفائز واحد', async () => {
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id IN ($1,$2)
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianAProfile, ids.technicianBProfile],
    );
    const orderId = await insertOrder('accept-admin');
    const assignmentId = await insertAssignment(orderId, ids.technicianAProfile);

    const outcomes = await Promise.allSettled([
      matchingService.accept(ids.technicianAUser, orderId),
      adminOrdersService.reassign(ids.adminUser, orderId, ids.technicianBProfile),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const [order] = await dataSource.query(`SELECT technician_id,order_status FROM orders WHERE id=$1`, [orderId]);
    const [assignment] = await dataSource.query(`SELECT assignment_status FROM order_assignments WHERE id=$1`, [assignmentId]);
    expect(order.order_status).toBe(OrderStatus.ACCEPTED);
    if (order.technician_id === ids.technicianAProfile) {
      expect(assignment.assignment_status).toBe(AssignmentStatus.ACCEPTED);
    } else {
      expect(order.technician_id).toBe(ids.technicianBProfile);
      expect(assignment.assignment_status).toBe(AssignmentStatus.CANCELLED);
    }
  });

  it('الأدمن لا يتجاوز أهلية المورد: إعادة التعيين لفني عنده طلب نشط ترفض', async () => {
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id = $1
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianBProfile],
    );
    // docs/08 §32 (طلب مالك صريح 2026-08-20) — ASAP بقى يتبع نفس قاعدة الطلب المجدول: طلب
    // accepted قصير لسه ما بدأش الفني ميستبعدش تاني من شغلانة قصيرة تانية في نفس اليوم (الفني
    // يقدر ياخد أكتر من شغلانة قصيرة). "منشغل فعليًا" دلوقتي (technician_on_way فما بعده) هي
    // الحالة الحقيقية اللي لسه بتستبعد — technicianAvailabilityCondition()'s ENGAGED_TECHNICIAN
    // _ORDER_STATUSES. status=ACCEPTED هنا كان بيعتمد على القاعدة القديمة (اتشالت في §32).
    await insertOrder('busy-tech', ids.technicianBProfile, OrderStatus.TECHNICIAN_ON_WAY);
    const targetOrder = await insertOrder('admin-target');
    await expect(adminOrdersService.reassign(ids.adminUser, targetOrder, ids.technicianBProfile)).rejects.toThrow(
      'الفني غير متاح في الوقت المطلوب لهذا الطلب',
    );
  });

  it('عرض سعر معلّق يفضل ماسك مورد الفني أمام القبول وإعادة التعيين', async () => {
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id = $1
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianBProfile],
    );
    const quoteOrder = await insertOrder(
      'quote-busy',
      ids.technicianBProfile,
      OrderStatus.AWAITING_QUOTE_APPROVAL,
    );

    const acceptTarget = await insertOrder('quote-accept-target');
    await insertAssignment(acceptTarget, ids.technicianBProfile);
    await expect(matchingService.accept(ids.technicianBUser, acceptTarget)).rejects.toThrow(
      'الفني غير متاح في الوقت المطلوب لهذا الطلب',
    );

    const reassignTarget = await insertOrder('quote-reassign-target');
    // docs/08 §32 (طلب مالك صريح 2026-08-20) — القيد القديم uq_orders_one_active_asap_per
    // _technician اتشال (migration 0152): الحماية ضد كتابة مباشرة متجاوزة للتطبيق بقت
    // application-level بس (نفس فلسفة الطلبات المجدولة من الأول، migration 0144's توثيق).
    // الاختبار ده بيتحقق من الحماية على مستوى التطبيق (accept/reassign) بس دلوقتي.
    await expect(
      adminOrdersService.reassign(ids.adminUser, reassignTarget, ids.technicianBProfile),
    ).rejects.toThrow('الفني غير متاح في الوقت المطلوب لهذا الطلب');

    await dataSource.query(`UPDATE orders SET order_status = 'in_progress' WHERE id = $1`, [quoteOrder]);
    await dataSource.query(`UPDATE orders SET order_status = 'awaiting_quote_approval' WHERE id = $1`, [quoteOrder]);
  });
  // docs/08 §72 — العرض بقى بيتعلّم `viewed` بمجرد ما جهاز الفني يسحبه. الاختبار ده بيثبّت
  // الحتة الخطيرة في التغيير ده: العرض **لازم يفضل في القايمة** بعد ما يتعلّم، وإلا الفني بيشوف
  // شغله مرة واحدة وبعدين القايمة تفضى.
  it('سحب قايمة الطلبات المتاحة بيعلّم العرض viewed ومع ذلك بيفضل ظاهر في السحب اللي بعده', async () => {
    const orderId = await insertOrder('viewed-mark');
    const assignmentId = await insertAssignment(orderId, ids.technicianAProfile);

    const first = await matchingService.listAvailableForTechnician(ids.technicianAUser);
    expect(first.some((row) => row.order_id === orderId)).toBe(true);

    const [afterFirst] = await dataSource.query(`SELECT assignment_status FROM order_assignments WHERE id = $1`, [
      assignmentId,
    ]);
    expect(afterFirst.assignment_status).toBe(AssignmentStatus.VIEWED);

    const second = await matchingService.listAvailableForTechnician(ids.technicianAUser);
    expect(second.some((row) => row.order_id === orderId)).toBe(true);

    // والقبول لسه شغال من حالة viewed — مش بس العرض ظاهر، هو لسه قابل للتنفيذ.
    await dataSource.query(
      `UPDATE orders SET order_status = 'completed'
       WHERE technician_id = $1
         AND order_status IN ('accepted','technician_on_way','technician_arrived','in_progress','awaiting_quote_approval')`,
      [ids.technicianAProfile],
    );
    const accepted = await matchingService.accept(ids.technicianAUser, orderId);
    expect(accepted.orderStatus).toBe(OrderStatus.ACCEPTED);
  });
});
