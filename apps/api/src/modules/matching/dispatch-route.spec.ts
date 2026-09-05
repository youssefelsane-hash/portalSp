import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { OrderAssignment } from './entities/order-assignment.entity';
import { describeDispatchRoute, resolveDispatchRoute } from './dispatch-route';
import { MatchingService } from './matching.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

/**
 * **الشرح اللي الأدمن بيقراه لازم يكون نفس القرار اللي اتنفّذ** (تدقيق §06 §4).
 *
 * قبل كده الأدمن كان بيشوف «وضع الحجز: أفراد» على طلبين اتصرّف فيهم النظام بشكلين مختلفين
 * تمامًا — واحد راح لجولات عروض (الفني قبل بنفسه)، والتاني اتعيّنله فني **بلا موافقته**. مفيش
 * أي حاجة في الشاشة كانت بتقول ليه.
 *
 * الخطر لو الشرح اتحسب في مكان تاني: يقول «تأكيد تلقائي» والمحرك يعمل جولات (أو العكس)،
 * فالأدمن ياخد قرار تشغيلي غلط مبني على شرح كذّاب — وده **أسوأ من مفيش شرح**.
 *
 * فالاختبار ده مابيختبرش الدالة الخالصة لوحدها: بيشغّل `dispatchOrAutoConfirm()` **الحقيقية**
 * على قاعدة حيّة، وبيقارن **الأثر الفعلي في القاعدة** (صفوف `order_assignments` مقابل
 * `orders.technician_id`) بالمسار اللي `resolveDispatchRoute()` بتقوله للأدمن.
 */
describe('مسار التوزيع — الشرح المعروض للأدمن = القرار المنفَّذ فعلاً (تدقيق §06 §4)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let matchingService: MatchingService;
  let cache: RedisCacheService;
  const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);

  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    technicians: [] as string[],
    orders: [] as string[],
  };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** بينشئ طلب `searching_technician` بالخصائص المطلوبة ويرجّع الـid. */
  async function createOrder(opts: {
    tag: string;
    bookingMode: 'individual' | 'emergency';
    orderType: string;
    scheduledAt: string | null;
    revisitPinnedTechnicianId?: string | null;
  }): Promise<string> {
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status,
                           total_amount_cents, booking_mode, order_type, scheduled_at,
                           revisit_pinned_technician_id, revisit_pinned_at)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',0,$6,$7,$8::timestamptz,$9,
               CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [
        `TDR${opts.tag}-${runId}`.slice(0, 24),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        opts.bookingMode,
        opts.orderType,
        opts.scheduledAt,
        opts.revisitPinnedTechnicianId ?? null,
      ],
    );
    ids.orders.push(row.id);
    return row.id;
  }

  /**
   * الأثر الفعلي في القاعدة.
   *
   * المسارين **الاتنين** بيكتبوا في `order_assignments`، فعدد الصفوف لوحده مش فارق — الفارق
   * الحقيقي هو **مين قال أيوه**:
   *  - جولات: صف `sent` مستني رد، والطلب لسه `searching_technician` بلا فني.
   *  - تأكيد تلقائي: صف `accepted` مكتوب من النظام نفسه (`responded_at` = وقت الإنشاء)،
   *    والفني اتحطّ على الطلب على طول.
   */
  async function observedRoute(orderId: string): Promise<'rounds' | 'auto_confirm' | 'nothing_happened'> {
    const [pending] = await q(
      `SELECT count(*)::int AS c FROM order_assignments WHERE order_id = $1 AND assignment_status = 'sent'`,
      [orderId],
    );
    const [order] = await q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
    if (order?.technician_id) return 'auto_confirm';
    if (pending.c > 0) return 'rounds';
    return 'nothing_happened';
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting, Order, OrderAssignment, OrderStatusHistory, TechnicianProfile, TechnicianLevelConfig],
    });
    await dataSource.initialize();
    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);

    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const assignmentGuard = new TechnicianAssignmentGuardService({
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
      getString: jest.fn(async (_k: string, fb: string) => fb),
    } as never);

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      assignmentGuard,
      settingsService,
      new EventEmitter2(),
      { add: async () => undefined } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة مسار ${runId}`,
      `Route City ${runId}`,
      `test-route-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق مسار ${runId}`,
      `Route Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة مسار ${runId}`,
      `Route Category ${runId}`,
      `test-route-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة مسار ${runId}`, `test-route-svc-${runId}`],
    );
    ids.service = svc.id;

    for (let i = 0; i < 3; i++) {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2035${i}${runId}`.slice(0, 14),
        `فني مسار ${i} ${runId}`,
      ]);
      const [profile] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
        [user.id, `TDR${i}${runId}`.slice(0, 20)],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.service]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
      ids.technicians.push(profile.id);
    }

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2036${runId}`.slice(0, 14),
      `عميل مسار ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع مسار ${runId}`],
    );
    ids.address = address.id;
  }, 60000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM technician_schedule_slots WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM chat_threads WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [ids.technicians]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [ids.technicians]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [ids.technicians]);
      await q(`DELETE FROM users WHERE phone_number LIKE $1`, [`%${runId}`]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
      cache.onModuleDestroy();
    }
  }, 30000);

  /**
   * الحالات الأربعة بتغطي كل `reason` ممكن يوصل للتوزيع. لكل واحدة: شغّل المحرك الحقيقي،
   * وقارن الأثر في القاعدة بالشرح.
   */
  const cases: {
    tag: string;
    labelAr: string;
    bookingMode: 'individual' | 'emergency';
    orderType: string;
    hoursFromNow: number | null;
    pinned: boolean;
    expectedRoute: 'rounds' | 'auto_confirm';
    expectedReason: string;
  }[] = [
    { tag: 'EMG', labelAr: 'طوارئ', bookingMode: 'emergency', orderType: 'emergency', hoursFromNow: null, pinned: false, expectedRoute: 'rounds', expectedReason: 'emergency' },
    { tag: 'PIN', labelAr: 'إعادة زيارة مثبّتة بموعد بعيد', bookingMode: 'individual', orderType: 'revisit', hoursFromNow: 24 * 10, pinned: true, expectedRoute: 'rounds', expectedReason: 'revisit_pinned' },
    { tag: 'NEAR', labelAr: 'فردي بموعد خلال ١٠ ساعات', bookingMode: 'individual', orderType: 'scheduled', hoursFromNow: 10, pinned: false, expectedRoute: 'rounds', expectedReason: 'near_term' },
    { tag: 'FAR', labelAr: 'فردي بموعد بعد ١٠ أيام', bookingMode: 'individual', orderType: 'scheduled', hoursFromNow: 24 * 10, pinned: false, expectedRoute: 'auto_confirm', expectedReason: 'scheduled_far' },
  ];

  it.each(cases)('$labelAr ⇒ $expectedRoute، والشرح مطابق للمنفَّذ', async (c) => {
    const scheduledAt = c.hoursFromNow === null ? null : new Date(Date.now() + c.hoursFromNow * 3600_000).toISOString();
    const orderId = await createOrder({
      tag: c.tag,
      bookingMode: c.bookingMode,
      orderType: c.orderType,
      scheduledAt,
      revisitPinnedTechnicianId: c.pinned ? ids.technicians[0] : null,
    });

    const orderBefore = await matchingService['orders'].findOne({ where: { id: orderId } });
    const nearTermHours = await matchingService.nearTermRequestHours();
    const decision = resolveDispatchRoute(orderBefore!, nearTermHours);

    // ١. الشرح اللي الأدمن هيقراه.
    expect(decision.reason).toBe(c.expectedReason);
    expect(decision.route).toBe(c.expectedRoute);
    expect(describeDispatchRoute(decision).length).toBeGreaterThan(10);

    // ٢. المحرك الحقيقي.
    await matchingService.dispatchOrAutoConfirm(orderId);

    // ٣. المقارنة — الأثر في القاعدة هو الحكم، مش نية الكود.
    expect(await observedRoute(orderId)).toBe(c.expectedRoute);
  });

  it('طلب مش في مرحلة التوزيع بيرجّع not_dispatchable — والمحرك فعلاً مابيعملش حاجة', async () => {
    const orderId = await createOrder({
      tag: 'NOP',
      bookingMode: 'individual',
      orderType: 'scheduled',
      scheduledAt: new Date(Date.now() + 24 * 10 * 3600_000).toISOString(),
    });
    await q(`UPDATE orders SET order_status = 'pending_payment' WHERE id = $1`, [orderId]);

    const orderBefore = await matchingService['orders'].findOne({ where: { id: orderId } });
    const decision = resolveDispatchRoute(orderBefore!, await matchingService.nearTermRequestHours());
    expect(decision).toMatchObject({ route: 'not_dispatchable', reason: 'not_searching' });

    await matchingService.dispatchOrAutoConfirm(orderId);
    expect(await observedRoute(orderId)).toBe('nothing_happened');
  });
});
