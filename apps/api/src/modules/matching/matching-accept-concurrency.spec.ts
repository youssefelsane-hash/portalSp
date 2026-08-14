import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechniciansService } from '../technicians/technicians.service';
import { AssignmentStatus, OrderAssignment } from './entities/order-assignment.entity';
import { MatchingService } from './matching.service';

// اختبار تزامن حقيقي ضد Postgres حقيقي (docs/08 §17.16) — بيثبت إن قفل pessimistic_write على
// صف الطلب في MatchingService.accept() فعليًا بيمنع قبول مزدوج لنفس الطلب، مش بس افتراض من قراءة
// الكود. فنيين حقيقيين، Promise.all حقيقي — التاني لازم يترفض بـCONFLICT، الفني الأول بس اللي
// ياخد الطلب، وعرض الخاسر لازم يتلغي أوتوماتيك (مش يفضل SENT معلّق للأبد).
describe('MatchingService.accept() — قبول مزدوج متزامن (regression/security §17.16)', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;
  let cache: RedisCacheService;

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
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting, Order, OrderAssignment, OrderStatusHistory, TechnicianProfile, TechnicianLevelConfig],
    });
    await dataSource.initialize();

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    // findByUserIdOrThrow/getOrThrow بس المُستخدمين فعليًا في accept() — باقي التبعيات مش لازمة هنا.
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const technicianLevelsService = new TechnicianLevelsService(dataSource.getRepository(TechnicianLevelConfig), {} as never);

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      technicianLevelsService,
      settingsService,
      { emit: () => true } as never,
      { add: async () => undefined } as never,
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
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty)
         VALUES ($1,$2,'new','approved',true,true) RETURNING id`,
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
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [ids.technicianAProfile, ids.technicianBProfile]);
    await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.technicianAUser, ids.technicianBUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await dataSource.destroy();
    cache.onModuleDestroy();
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
});
