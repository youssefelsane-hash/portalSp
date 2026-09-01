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
import { MatchingService } from './matching.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

/**
 * ADR-0051 (docs/08 §96، بلاغ مالك: «الطلب بيتوزع عشوائي على الناس، ده ما ينفعش»).
 *
 * الاختبار الحي ده بيثبت إن التثبيت **التزام صارم مش تفضيل**: `requested_technician_id` القديم
 * كان بيتجاهَل ويتبثّ لفنيين عشوائيين في نفس الجولة لو الفني الأصلي مش مؤهّل دلوقتي —
 * `revisit_pinned_technician_id` ما بيعملش كده أبدًا، وبيفضل مستني لحد ما الأدمن يحرّر.
 */
describe('MatchingService.dispatchNextRound() — إعادة الزيارة مثبّتة على الفني الأصلي (ADR-0051)', () => {
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
    order: '',
    technicians: [] as string[],
  };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

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
      `مدينة تثبيت ${runId}`,
      `Pin City ${runId}`,
      `test-pin-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تثبيت ${runId}`,
      `Pin Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تثبيت ${runId}`,
      `Pin Category ${runId}`,
      `test-pin-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة تثبيت ${runId}`, `test-pin-svc-${runId}`],
    );
    ids.service = svc.id;

    // 4 فنيين كلهم مؤهّلين تمامًا لنفس الخدمة/النطاق — لو التثبيت مكسور، البث هيروح لهم كلهم.
    for (let i = 0; i < 4; i++) {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2033${i}${runId}`.slice(0, 14),
        `فني تثبيت ${i} ${runId}`,
      ]);
      const [profile] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
        [user.id, `TPIN${i}${runId}`.slice(0, 20)],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.service]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
      ids.technicians.push(profile.id);
    }

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2034${runId}`.slice(0, 14),
      `عميل تثبيت ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع تثبيت ${runId}`],
    );
    ids.address = address.id;

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents,
                           booking_mode, order_type, revisit_pinned_technician_id, revisit_pinned_at)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',0,'individual','revisit',$6, now()) RETURNING id`,
      [`TPIN-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, ids.technicians[0]],
    );
    ids.order = order.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
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
  }, 20000);

  it('العرض بيروح للفني الأصلي لوحده — مفيش أي بث لباقي الفنيين المؤهّلين', async () => {
    await matchingService.dispatchNextRound(ids.order);

    const rows = await q(`SELECT technician_id FROM order_assignments WHERE order_id = $1`, [ids.order]);
    expect(rows).toHaveLength(1);
    expect(rows[0].technician_id).toBe(ids.technicians[0]);
  }, 20000);

  it('المهلة عدّت على العرض — مفيش توسيع بث لفنيين تانيين (بعكس الطلب العادي)', async () => {
    await q(`UPDATE order_assignments SET expires_at = now() - interval '1 second' WHERE order_id = $1`, [ids.order]);

    await matchingService.dispatchNextRound(ids.order);

    const rows = await q(`SELECT technician_id FROM order_assignments WHERE order_id = $1`, [ids.order]);
    expect(rows).toHaveLength(1);
    expect(rows[0].technician_id).toBe(ids.technicians[0]);
  }, 20000);

  it('بعد ما الأدمن يحرّر — الطلب بيمشي في التوزيع العادي ويوصل لفنيين تانيين', async () => {
    await q(
      `UPDATE orders SET revisit_released_at = now(), revisit_release_reason = 'no_response' WHERE id = $1`,
      [ids.order],
    );
    await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);

    await matchingService.dispatchNextRound(ids.order);

    const rows = await q(`SELECT technician_id FROM order_assignments WHERE order_id = $1`, [ids.order]);
    expect(rows.length).toBeGreaterThan(1);
  }, 20000);
});
