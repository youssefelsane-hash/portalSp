import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { AdminOrdersService } from '../orders/admin-orders.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderStatus } from '../orders/entities/order.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { AssignmentStatus, OrderAssignment } from './entities/order-assignment.entity';
import { MatchingService } from './matching.service';

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

  async function insertOrder(label: string, technicianId?: string, status = OrderStatus.SEARCHING_TECHNICIAN): Promise<string> {
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, total_amount_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,10000) RETURNING id`,
      [`P7-${label}-${runId}`.slice(0, 24), ids.customerProfile, technicianId ?? null, ids.service, ids.address, ids.zone, status],
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
    );
    const assignmentGuard = new TechnicianAssignmentGuardService();

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      assignmentGuard,
      {} as never,
      { emit: () => true } as never,
      { add: async () => undefined } as never,
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
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    );
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
       VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
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
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
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

  it('نفس الفني يقبل طلبين مختلفين بالتوازي — مورد الفني المشترك يسمح بطلب نشط واحد', async () => {
    await dataSource.query(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [ids.order]);
    const orderA = await insertOrder('same-tech-a');
    const orderB = await insertOrder('same-tech-b');
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
    await insertOrder('busy-tech', ids.technicianBProfile, OrderStatus.ACCEPTED);
    const targetOrder = await insertOrder('admin-target');
    await expect(adminOrdersService.reassign(ids.adminUser, targetOrder, ids.technicianBProfile)).rejects.toThrow(
      'الفني عنده طلب نشط بالفعل',
    );
  });

  it('عرض سعر معلّق يفضل ماسك مورد الفني أمام القبول وإعادة التعيين والكتابة المباشرة', async () => {
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
      'الفني عنده طلب نشط بالفعل',
    );

    const reassignTarget = await insertOrder('quote-reassign-target');
    await expect(
      adminOrdersService.reassign(ids.adminUser, reassignTarget, ids.technicianBProfile),
    ).rejects.toThrow('الفني عنده طلب نشط بالفعل');

    await expect(
      dataSource.query(
        `UPDATE orders SET technician_id = $1, order_status = 'accepted' WHERE id = $2`,
        [ids.technicianBProfile, reassignTarget],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'uq_orders_one_active_per_technician' });

    await dataSource.query(`UPDATE orders SET order_status = 'in_progress' WHERE id = $1`, [quoteOrder]);
    await dataSource.query(`UPDATE orders SET order_status = 'awaiting_quote_approval' WHERE id = $1`, [quoteOrder]);
  });
});
