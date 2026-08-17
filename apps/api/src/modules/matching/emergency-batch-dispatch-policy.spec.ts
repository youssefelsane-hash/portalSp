import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import {
  ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT,
  OrderEmergencyDispatchStrugglingEvent,
} from '../../common/events/order-emergency-dispatch-struggling.event';
import { ORDER_OFFER_CREATED_EVENT } from '../../common/events/order-offer-created.event';
import { AuditLogService } from '../audit/audit-log.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechniciansService } from '../technicians/technicians.service';
import { OrderAssignment } from './entities/order-assignment.entity';
import { MatchingService } from './matching.service';

// اختبار حي ضد Postgres حقيقي (docs/08 §17.15) — تدرّج دفعات الطوارئ الفعلي: دفعة أولى/تالية
// منفصلتين، سقف أقصى لإجمالي الفنيين المتواصَل معاهم عبر كل الجولات، تصعيد تلقائي لإشعار الأدمن
// بعد عدد جولات معيّن. كل القيم دي إعدادات حقيقية في القاعدة (SQL خام، مش SettingsService.update()
// — لازم إبطال كاش يدوي، نفس الدرس اللي اتوثّق في technician-productivity.service.spec.ts).
describe('MatchingService.dispatchNextRound() — تدرّج دفعات الطوارئ (§17.15)', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;
  let cache: RedisCacheService;
  let events: EventEmitter2;
  const emittedOfferCounts: number[] = [];
  const escalations: OrderEmergencyDispatchStrugglingEvent[] = [];

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    order: '',
    technicians: [] as string[],
  };

  const SETTINGS_KEYS = [
    'matching.emergency_batch_size',
    'matching.emergency_subsequent_batch_size',
    'matching.emergency_max_technicians_contacted',
    'matching.emergency_escalation_after_rounds',
    'matching.max_rounds',
    'matching.response_timeout_seconds',
    'matching.emergency_response_timeout_seconds',
  ];

  const setSetting = async (key: string, value: number) => {
    await dataSource.query(
      `INSERT INTO settings (key, value, value_type, group_name) VALUES ($1, $2, 'number', 'matching')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
    await cache.del(`settings:${key}`);
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
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never, // usersRepo — مش متنادى في المسار المُختبر هنا
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const assignmentGuard = new TechnicianAssignmentGuardService();

    events = new EventEmitter2();
    events.on(ORDER_OFFER_CREATED_EVENT, () => {
      emittedOfferCounts.push(1);
    });
    events.on(ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT, (event: OrderEmergencyDispatchStrugglingEvent) => {
      escalations.push(event);
    });

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      assignmentGuard,
      settingsService,
      events,
      { add: async () => undefined } as never,
    );

    // إعدادات الاختبار: دفعة أولى=2، تالية=3 (مختلفة عمدًا عشان نثبت إنهم قابلين للتعديل
    // منفصلين)، سقف إجمالي=4 (هيحدّ الجولة التانية لـ2 بدل 3، ويمنع جولة تالتة تمامًا)،
    // تصعيد بعد جولتين بالظبط.
    await setSetting('matching.emergency_batch_size', 2);
    await setSetting('matching.emergency_subsequent_batch_size', 3);
    await setSetting('matching.emergency_max_technicians_contacted', 4);
    await setSetting('matching.emergency_escalation_after_rounds', 2);
    await setSetting('matching.max_rounds', 5);
    await setSetting('matching.emergency_response_timeout_seconds', 15);

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
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-${runId}`],
    );
    ids.service = svc.id;

    // 6 فنيين — كفاية لجولة أولى (2) + جولة تانية بعد التحديد (2 بعد الـcap) بلا تداخل.
    for (let i = 0; i < 6; i++) {
      const label = `E${i}`;
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
        [`+201${label}${runId}`.slice(0, 14), `فني طوارئ اختبار ${label} ${runId}`],
      );
      const [profile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
        [user.id, `TSTE${label}${runId}`.slice(0, 20)],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [
        profile.id,
        ids.service,
      ]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
        profile.id,
        ids.zone,
      ]);
      ids.technicians.push(profile.id);
    }

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
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',10000,'emergency') RETURNING id`,
      [`TEST-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [ids.technicians]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [ids.technicians]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [ids.technicians]);
    await q(
      `DELETE FROM users WHERE phone_number LIKE $1`,
      [`+201%${runId}`],
    );
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await q(`DELETE FROM notification_routing_rules WHERE event_type = 'order.emergency_dispatch_struggling'`);
    for (const key of SETTINGS_KEYS) {
      await q(`DELETE FROM settings WHERE key = $1`, [key]);
      await cache.del(`settings:${key}`);
    }
    await dataSource.destroy();
    cache.onModuleDestroy();
  });

  it('الجولة الأولى بتستخدم emergency_batch_size (2)، مش emergency_subsequent_batch_size', async () => {
    const result = await matchingService.dispatchNextRound(ids.order);
    expect(result.dispatched).toBe(2);

    const round1 = await dataSource.query(
      `SELECT technician_id FROM order_assignments WHERE order_id = $1 AND assignment_round = 1`,
      [ids.order],
    );
    expect(round1).toHaveLength(2);
  });

  it('الجولة التانية بتستخدم emergency_subsequent_batch_size بس السقف الإجمالي (4) بيقصّها لـ2 مش 3', async () => {
    // هنا يبقى إجمالي الفنيين المتواصَل معاهم لسه دلوقتي 2 (من الجولة الأولى) — الميزانية
    // المتبقية = 4-2=2، فالدفعة التالية (المطلوبة 3) بتتقصّ لـ2 فعليًا، مش بترفض تمامًا ولا
    // بتتجاهل السقف. الجولة دي كمان هي عتبة التصعيد (emergency_escalation_after_rounds=2).
    const result = await matchingService.dispatchNextRound(ids.order);
    expect(result.dispatched).toBe(2);

    const round2 = await dataSource.query(
      `SELECT technician_id FROM order_assignments WHERE order_id = $1 AND assignment_round = 2`,
      [ids.order],
    );
    expect(round2).toHaveLength(2);

    // إجمالي الفنيين المتواصَل معاهم بقى 4 بالظبط (2+2) — وصل للسقف تمامًا.
    const totalContacted = await dataSource.query(`SELECT COUNT(*) AS c FROM order_assignments WHERE order_id = $1`, [
      ids.order,
    ]);
    expect(Number(totalContacted[0].c)).toBe(4);

    expect(escalations).toHaveLength(1);
    expect(escalations[0].roundsSoFar).toBe(2);
    expect(escalations[0].techniciansContactedSoFar).toBe(4);
  });

  it('الجولة التالتة: الميزانية خلصت (4/4) فالطلب بيتلغي فورًا بدل ما يبعت لأي فني تاني', async () => {
    const result = await matchingService.dispatchNextRound(ids.order);
    expect(result.dispatched).toBe(0);

    const round3 = await dataSource.query(
      `SELECT * FROM order_assignments WHERE order_id = $1 AND assignment_round = 3`,
      [ids.order],
    );
    expect(round3).toHaveLength(0);

    const [order] = await dataSource.query(`SELECT order_status FROM orders WHERE id = $1`, [ids.order]);
    expect(order.order_status).toBe('cancelled_by_system');

    // التصعيد بيتصدّر مرة واحدة بس (وقت الجولة 2)، مش تاني في الجولة 3.
    expect(escalations).toHaveLength(1);
  });
});
