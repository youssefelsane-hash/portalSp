import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { Order } from '../orders/entities/order.entity';
import { OrderTeamMember } from '../orders/entities/order-team-member.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { AssistantMatchingService } from './assistant-matching.service';
import { OrderAssistantOffer } from './entities/order-assistant-offer.entity';

/**
 * ADR-0061 §3 — **بث المساعدين بيستخدم نفس محرك التوافر بتاع الفني القائد**.
 *
 * كل حالة هنا كانت بتدّي نتيجة غلط تحت النسخة الموازية القديمة، والتلاتة أعطال حقيقية مش
 * تفاصيل شكلية:
 *
 *  - مساعد عنده شغلانة قصيرة في **يوم تاني** كان بيتشال من كل عروض النهاردة (بَقّة ADR-0018 §32
 *    اللي اتصلحت للفني القائد وفضلت عايشة هنا).
 *  - مساعد يومه مليان 12 ساعة كان **مقبول** لأن السقف اليومي (ADR-0059) ماكانش بيتطبّق عليه خالص.
 *  - مساعد حاجز اليوم لنفسه (إجازة) كان **مقبول** لأن الاستعلام كان بيفحص `booked` بدل `blocked`.
 */
describe('توافر المساعد = توافر الفني (ADR-0061 §3)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let service: AssistantMatchingService;
  let cache: RedisCacheService;

  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    city: '', zone: '', category: '', service: '',
    leadUser: '', leadProfile: '',
    freeUser: '', freeProfile: '',
    otherDayUser: '', otherDayProfile: '',
    fullDayUser: '', fullDayProfile: '',
    blockedUser: '', blockedProfile: '',
    customerUser: '', customerProfile: '', address: '',
    order: '',
    loadOrders: [] as string[],
  };

  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  /** يوم مصري بعد N يوم — نفس تعريف التقويم اللي محرك التوافر بيستخدمه. */
  const dayAfter = (offset: number): string =>
    new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  const TARGET_DAY = dayAfter(30);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting, Order, OrderAssistantOffer, OrderTeamMember, TechnicianProfile],
    });
    await dataSource.initialize();

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );

    service = new AssistantMatchingService(
      dataSource.getRepository(OrderAssistantOffer),
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      techniciansService,
      settingsService,
      { emit: () => true } as never,
      { add: async () => undefined, remove: async () => undefined } as never,
    );

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `asst-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة ${runId}`, `zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [cat] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ${runId}`, `cat ${runId}`, `asst-cat-${runId.toLowerCase()}`,
    ]);
    ids.category = cat.id;
    // مدة الخدمة 120 دقيقة — دي مدة الطلب المرشّح اللي بتتجمّع مع حِمل اليوم عند المساعد.
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, pricing_model, base_price_cents, estimated_duration_minutes)
       VALUES ($1,$2,$3,$4,'formula',10000,120) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc ${runId}`, `asst-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;

    const makeTechnician = async (label: string, kind: 'technician' | 'assistant'): Promise<{ userId: string; profileId: string }> => {
      const [u] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2097${runId}${label}`.slice(0, 15), `${kind} ${label} ${runId}`,
      ]);
      const [p] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, verification_status, technician_kind, current_location)
         VALUES ($1,$2,'approved',$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [u.id, `AST-${runId}-${label}`, kind],
      );
      return { userId: u.id, profileId: p.id };
    };

    const lead = await makeTechnician('L', 'technician');
    ids.leadUser = lead.userId;
    ids.leadProfile = lead.profileId;
    const free = await makeTechnician('F', 'assistant');
    ids.freeUser = free.userId;
    ids.freeProfile = free.profileId;
    const otherDay = await makeTechnician('O', 'assistant');
    ids.otherDayUser = otherDay.userId;
    ids.otherDayProfile = otherDay.profileId;
    const fullDay = await makeTechnician('U', 'assistant');
    ids.fullDayUser = fullDay.userId;
    ids.fullDayProfile = fullDay.profileId;
    const blocked = await makeTechnician('B', 'assistant');
    ids.blockedUser = blocked.userId;
    ids.blockedProfile = blocked.profileId;

    for (const assistantId of [ids.freeProfile, ids.otherDayProfile, ids.fullDayProfile, ids.blockedProfile]) {
      await q(
        `INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`,
        [assistantId, ids.service],
      );
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [assistantId, ids.zone]);
    }

    const [cu] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2096${runId}`.slice(0, 15), `عميل ${runId}`,
    ]);
    ids.customerUser = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع ${runId}`],
    );
    ids.address = addr.id;

    /** حِمل حقيقي على مساعد — طلب نشط بيقوده هو نفسه. */
    const loadOrder = async (technicianId: string, day: string, minutes: number): Promise<void> => {
      const [o] = await q(
        `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
                             order_status, scheduled_at, duration_minutes, total_amount_cents)
         VALUES ($1,$2,$3,$4,$5,$6,'accepted', ($7 || ' 09:00')::timestamp AT TIME ZONE 'Africa/Cairo', $8, 10000)
         RETURNING id`,
        [`AST-${runId}-${ids.loadOrders.length}`, ids.customerProfile, ids.service, ids.address, ids.zone, technicianId, day, minutes],
      );
      ids.loadOrders.push(o.id);
    };

    // «O»: شغلانة ساعتين بعد التاريخ المطلوب بخمس أيام — مالهاش أي علاقة بيوم الطلب.
    await loadOrder(ids.otherDayProfile, dayAfter(35), 120);
    // «U»: يومه المطلوب مليان بالكامل (12 ساعة = السقف الافتراضي).
    await loadOrder(ids.fullDayProfile, TARGET_DAY, 720);
    // «B»: حاجز اليوم لنفسه صراحةً (إجازة) — مش شغل، قرار شخصي.
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, $2::date, '00:00', '23:59', 'blocked')`,
      [ids.blockedProfile, TARGET_DAY],
    );

    // الطلب المطلوب استكماله: 4 شرائح مساعد عشان كل المؤهلين ياخدوا عرض (مش أول واحد بس).
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
                           order_status, scheduled_at, total_amount_cents, required_assistants)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned', ($7 || ' 09:00')::timestamp AT TIME ZONE 'Africa/Cairo', 10000, 4)
       RETURNING id`,
      [`AST-${runId}-MAIN`, ids.customerProfile, ids.leadProfile, ids.service, ids.address, ids.zone, TARGET_DAY],
    );
    ids.order = order.id;
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_assistant_offers WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [[ids.order, ...ids.loadOrders]]);
      const profiles = [ids.leadProfile, ids.freeProfile, ids.otherDayProfile, ids.fullDayProfile, ids.blockedProfile];
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [profiles]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [
        [ids.customerUser, ids.leadUser, ids.freeUser, ids.otherDayUser, ids.fullDayUser, ids.blockedUser],
      ]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('البث بيتبع نفس قواعد توافر الفني بالحرف', async () => {
    await service.startMatching(ids.order);

    const offered = await q<{ assistant_technician_id: string }>(
      `SELECT assistant_technician_id FROM order_assistant_offers WHERE order_id = $1`,
      [ids.order],
    );
    const offeredIds = offered.map((o) => o.assistant_technician_id);

    // المساعد الفاضي — الحالة الأساسية.
    expect(offeredIds).toContain(ids.freeProfile);

    // **البَقّة الأولى**: شغلانة ساعتين في يوم تاني ماتشيلوش من عروض اليوم ده.
    expect(offeredIds).toContain(ids.otherDayProfile);

    // **البَقّة التانية**: السقف اليومي (ADR-0059) بيسري على المساعد زي الفني بالظبط.
    expect(offeredIds).not.toContain(ids.fullDayProfile);

    // **البَقّة التالتة**: إجازة المساعد الصريحة بتتقرا فعلاً.
    expect(offeredIds).not.toContain(ids.blockedProfile);
  });
});
