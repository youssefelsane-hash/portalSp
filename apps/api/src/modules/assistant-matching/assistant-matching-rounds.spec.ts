import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { ASSISTANT_MATCHING_ESCALATED_EVENT } from '../../common/events/assistant-matching-escalated.event';
import { Order } from '../orders/entities/order.entity';
import { OrderTeamMember } from '../orders/entities/order-team-member.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { AssistantMatchingService } from './assistant-matching.service';
import { OrderAssistantOffer } from './entities/order-assistant-offer.entity';

/**
 * ADR-0061 §4 — **جولات بث قبل التصعيد**.
 *
 * قبل التغيير ده كانت فيه جولة واحدة: أول دفعة مرشّحين ماتردش في المهلة ⇒ العمليات بتتنده على
 * طول، حتى لو فيه مساعدين مؤهلين متاحين لسه ماتسألوش أصلاً. تصعيد كاذب بيحوّل شغل الغطاء
 * التلقائي لشغل يدوي.
 *
 * السيناريو هنا حقيقي بالكامل: مساعد تاني كان حاجز اليوم لنفسه وقت الجولة الأولى (فما اتسألش)،
 * وشال الحجز بعدها. الجولة التانية لازم توصله، والتصعيد يستنى لحد ما المجمع يخلص فعلاً.
 */
describe('جولات مطابقة المساعدين (ADR-0061 §4)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let service: AssistantMatchingService;
  let cache: RedisCacheService;
  const escalations: { orderId: string; remaining: number }[] = [];

  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    city: '', zone: '', category: '', service: '',
    leadUser: '', leadProfile: '',
    firstUser: '', firstProfile: '',
    secondUser: '', secondProfile: '',
    customerUser: '', customerProfile: '', address: '', order: '',
  };

  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  const TARGET_DAY = new Date(Date.now() + 45 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

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
      {
        emit: (name: string, payload: { orderId: string; remainingSlots: number }) => {
          if (name === ASSISTANT_MATCHING_ESCALATED_EVENT) {
            escalations.push({ orderId: payload.orderId, remaining: payload.remainingSlots });
          }
          return true;
        },
      } as never,
      { add: async () => undefined, remove: async () => undefined } as never,
    );

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `rnd-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة ${runId}`, `zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [cat] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ${runId}`, `cat ${runId}`, `rnd-cat-${runId.toLowerCase()}`,
    ]);
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, pricing_model, base_price_cents, estimated_duration_minutes)
       VALUES ($1,$2,$3,$4,'formula',10000,120) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc ${runId}`, `rnd-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;

    const makeTechnician = async (label: string, kind: 'technician' | 'assistant') => {
      const [u] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2095${runId}${label}`.slice(0, 15), `${kind} ${label} ${runId}`,
      ]);
      const [p] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, verification_status, technician_kind, current_location)
         VALUES ($1,$2,'approved',$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [u.id, `RND-${runId}-${label}`, kind],
      );
      return { userId: u.id as string, profileId: p.id as string };
    };

    const lead = await makeTechnician('L', 'technician');
    ids.leadUser = lead.userId;
    ids.leadProfile = lead.profileId;
    const first = await makeTechnician('1', 'assistant');
    ids.firstUser = first.userId;
    ids.firstProfile = first.profileId;
    const second = await makeTechnician('2', 'assistant');
    ids.secondUser = second.userId;
    ids.secondProfile = second.profileId;

    for (const assistantId of [ids.firstProfile, ids.secondProfile]) {
      await q(
        `INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`,
        [assistantId, ids.service],
      );
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [assistantId, ids.zone]);
    }

    // المساعد التاني حاجز اليوم لنفسه وقت الجولة الأولى — فمش هيتسأل فيها أصلاً.
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, $2::date, '00:00', '23:59', 'blocked')`,
      [ids.secondProfile, TARGET_DAY],
    );

    const [cu] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2094${runId}`.slice(0, 15), `عميل ${runId}`,
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

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
                           order_status, scheduled_at, total_amount_cents, required_assistants)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned', ($7 || ' 09:00')::timestamp AT TIME ZONE 'Africa/Cairo', 10000, 1)
       RETURNING id`,
      [`RND-${runId}-MAIN`, ids.customerProfile, ids.leadProfile, ids.service, ids.address, ids.zone, TARGET_DAY],
    );
    ids.order = order.id;
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_assistant_offers WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      const profiles = [ids.leadProfile, ids.firstProfile, ids.secondProfile];
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [profiles]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customerUser, ids.leadUser, ids.firstUser, ids.secondUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  const offersByRound = async (): Promise<{ assistant_technician_id: string; matching_round: number; offer_status: string }[]> =>
    q(
      `SELECT assistant_technician_id, matching_round, offer_status
       FROM order_assistant_offers WHERE order_id = $1 ORDER BY matching_round`,
      [ids.order],
    );

  it('الجولة الأولى بتوصل المتاح، والتانية بتوصل اللي اتحرر — والتصعيد بعد ما المجمع يخلص', async () => {
    await service.startMatching(ids.order);

    const round1 = await offersByRound();
    expect(round1).toHaveLength(1);
    expect(round1[0].assistant_technician_id).toBe(ids.firstProfile);
    expect(round1[0].matching_round).toBe(1);
    expect(escalations).toHaveLength(0);

    // المساعد التاني شال حجز يومه — بقى متاح فعليًا.
    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.secondProfile]);

    // مهلة الجولة الأولى خلصت ومحدش رد.
    await service.handleExpiry(ids.order);

    const round2 = await offersByRound();
    expect(round2).toHaveLength(2);
    const second = round2.find((o) => o.assistant_technician_id === ids.secondProfile);
    expect(second?.matching_round).toBe(2);
    // عرض الجولة الأولى اتقفل expired، مش فاضل معلّق.
    expect(round2.find((o) => o.assistant_technician_id === ids.firstProfile)?.offer_status).toBe('expired');
    // **النقطة**: لسه مفيش تصعيد — فيه مسار تلقائي لسه شغّال.
    expect(escalations).toHaveLength(0);

    // مهلة الجولة التانية خلصت كمان، والمجمع خلص فعلاً.
    await service.handleExpiry(ids.order);

    const round3 = await offersByRound();
    expect(round3).toHaveLength(2); // مفيش مرشّح جديد يتضاف
    expect(escalations).toEqual([{ orderId: ids.order, remaining: 1 }]);
  });
});
