import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../../audit/audit-log.service';
import { RedisCacheService } from '../../../common/cache/redis-cache.service';
import { Setting } from '../../settings/entities/setting.entity';
import { SettingsService } from '../../settings/settings.service';
import { User } from '../../auth/entities/user.entity';
import { Order, BookingMode, OrderStatus } from '../../orders/entities/order.entity';
import { TechnicianProfile, TechnicianLevel } from '../../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../../technicians/entities/technician-company.entity';
import { TechniciansService } from '../../technicians/technicians.service';
import { Notification, NotificationChannel } from '../entities/notification.entity';
import { NotificationTypeConfig } from '../entities/notification-type-config.entity';
import { NotificationWorkflow } from '../entities/notification-workflow.entity';
import { UserDevice } from '../entities/user-device.entity';
import { UserNotificationPreference } from '../entities/user-notification-preference.entity';
import { NotificationsService } from '../notifications.service';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { OrderCrewShortageLeaderReminderListener } from './order-crew-shortage-leader-reminder.listener';
import { OrderCrewShortageEscalatedEvent } from '../../../common/events/order-crew-shortage-escalated.event';

// اختبار حي — تذكير القائد بنقص طاقمه (docs/08 §35.17). نفس نمط crew-shortage-escalation.spec.ts
// (TechniciansService حقيقي جزئيًا: repos اللي findByProfileIdOrThrow فعلًا محتاجها متوصّلة
// بـPostgres حقيقي، الباقي stub لأنه مش مستخدم في المسار ده) + نمط notification-acknowledgement.spec.ts
// (NotificationsService حقيقي بديسباتشر in-memory بدل الحقيقي، عشان نتأكد من صف notifications الفعلي).
describe('OrderCrewShortageLeaderReminderListener (docs/08 §35.17)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let listener: OrderCrewShortageLeaderReminderListener;
  let notificationsService: NotificationsService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { customerProfile: '', address: '', service: '', category: '', zone: '', city: '', country: '', leaderProfile: '' };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertOrder(label: string, opts: { technicianId: string | null }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians, required_assistants, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,0,'team',2,1,now() + interval '2 hours') RETURNING id, order_number`,
      [`TESTLDR-${label}`.slice(0, 24), ids.customerProfile, opts.technicianId, ids.service, ids.address, ids.zone, OrderStatus.TECHNICIAN_ASSIGNED],
    );
    return { id: order.id as string, orderNumber: order.order_number as string };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, User, TechnicianProfile, TechnicianCompany, Notification, NotificationWorkflow, NotificationTypeConfig, UserDevice, UserNotificationPreference, Setting],
    });
    await dataSource.initialize();

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة تذكير ${runId}`,
      `Reminder City ${runId}`,
      `test-reminder-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق تذكير ${runId}`,
      `Reminder Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تذكير ${runId}`,
      `Reminder Category ${runId}`,
      `test-reminder-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [category.id, `خدمة تذكير ${runId}`, `test-reminder-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2050${runId}`.slice(0, 15),
      `عميل تذكير ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تذكير ${runId}`],
    );
    ids.address = address.id;

    const [leaderUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2051${runId}`.slice(0, 15),
      `قائد تذكير ${runId}`,
    ]);
    users.push(leaderUser.id);
    const [leaderProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,$3,'approved',true) RETURNING id`,
      [leaderUser.id, `TCLDR${runId}`.slice(0, 20), TechnicianLevel.PROFESSIONAL],
    );
    ids.leaderProfile = leaderProfile.id;

    // TechniciansService خفيف — بس الـrepos اللي findByProfileIdOrThrow() فعلًا بتلمسها متوصّلة
    // بحقيقي، الباقي stub لأنها مش على مسار الاستمعان ده (نفس نمط crew-shortage-escalation.spec.ts).
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

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    const workflowService = new NotificationWorkflowService(
      dataSource.getRepository(NotificationWorkflow),
      dataSource.getRepository(NotificationTypeConfig),
      settingsService,
    );
    notificationsService = new NotificationsService(
      dataSource.getRepository(Notification),
      dataSource.getRepository(UserDevice),
      dataSource.getRepository(User),
      dataSource.getRepository(UserNotificationPreference),
      dataSource.getRepository(NotificationTypeConfig),
      { dispatch: async () => ({ delivered: true, failureReason: null }) } as never,
      workflowService,
    );

    listener = new OrderCrewShortageLeaderReminderListener(dataSource.getRepository(Order), techniciansService, notificationsService);
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM notifications WHERE user_id = ANY($1)`, [users]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTLDR-%`]);
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (ids.leaderProfile) await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.leaderProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      if (ids.zone) await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      if (ids.city) await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 15000);

  it('طلب فريق ناقص فني ومساعد — القائد بياخد إشعار تذكير حقيقي بالنص الصحيح', async () => {
    const order = await insertOrder('missing-both', { technicianId: ids.leaderProfile });
    await listener.handle(new OrderCrewShortageEscalatedEvent(order.id, order.orderNumber, new Date(), 1, 1));

    const rows = await q(
      `SELECT title_ar, body_ar, reference_id, notification_type FROM notifications WHERE user_id = (SELECT user_id FROM technician_profiles WHERE id = $1) AND notification_type = 'crew_shortage_leader_reminder' ORDER BY created_at DESC LIMIT 1`,
      [ids.leaderProfile],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reference_id).toBe(order.id);
    expect(rows[0].body_ar).toContain('1 فني');
    expect(rows[0].body_ar).toContain('1 مساعد');
  });

  it('طلب فردي التوزيع (technician_id فاضي) — الاستمعان بيرجع من غير ما يبعت إشعار وميرميش استثناء', async () => {
    const order = await insertOrder('no-technician', { technicianId: null });
    await expect(
      listener.handle(new OrderCrewShortageEscalatedEvent(order.id, order.orderNumber, new Date(), 2, 0)),
    ).resolves.toBeUndefined();

    const rows = await q(`SELECT id FROM notifications WHERE reference_id = $1`, [order.id]);
    expect(rows).toHaveLength(0);
  });

  it('طلب اتصعّد لفني مش موجود بروفايله — الاستمعان بيمسك الاستثناء ومايعلقش', async () => {
    const fakeOrderId = randomUUID();
    await expect(
      listener.handle(new OrderCrewShortageEscalatedEvent(fakeOrderId, 'TESTLDR-GHOST', new Date(), 1, 0)),
    ).resolves.toBeUndefined();
  });
});
