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
import { AssistantOfferStatus, OrderAssistantOffer } from './entities/order-assistant-offer.entity';

// اختبار تزامن حقيقي ضد Postgres حقيقي (docs/08 §17.16) — بيثبت إن قفل pessimistic_write على صف
// الطلب في AssistantMatchingService.accept() فعليًا بيمنع اتنين فنيين ياخدوا نفس الشريحة الوحيدة
// المتاحة، "أول قبول صحيح ياخدها" بالحرف مش افتراض.
describe('AssistantMatchingService.accept() — قبول مزدوج متزامن على شريحة واحدة (regression/security §17.16)', () => {
  let dataSource: DataSource;
  let service: AssistantMatchingService;
  let cache: RedisCacheService;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    mainTechnicianUser: '',
    mainTechnicianProfile: '',
    assistantAUser: '',
    assistantAProfile: '',
    assistantBUser: '',
    assistantBProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    order: '',
    offerA: '',
    offerB: '',
  };

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

    service = new AssistantMatchingService(
      dataSource.getRepository(OrderAssistantOffer),
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      techniciansService,
      settingsService,
      { emit: () => true } as never,
      { remove: async () => undefined } as never,
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    // نفس بَقّة نظافة الاختبارات اللي اتصلحت في matching-work-opportunity.spec.ts (§63 شريحة 5):
    // إنشاء دولة بـiso_code عشوائي من حرفين مساحته صغيرة جدًا واحتمال تصادمه عالي، وتنظيف
    // afterAll بيفشل على قيود المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم
    // مسألة وقت. بنستعمل دولة موجودة أصلاً بدل ما ننشئ واحدة.
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
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-${runId}`],
    );
    ids.service = svc.id;

    const makeTechnician = async (label: string, kind: 'technician' | 'assistant' = 'technician') => {
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
        [`+201${label}${runId}`.slice(0, 14), `فني اختبار ${label} ${runId}`],
      );
      const [profile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
            technician_kind, current_location)
         VALUES ($1,$2,'new','approved',true,true,$3,
                 ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `TST${label}${runId}`.slice(0, 20), kind],
      );
      return { userId: user.id as string, profileId: profile.id as string };
    };

    const main = await makeTechnician('M');
    ids.mainTechnicianUser = main.userId;
    ids.mainTechnicianProfile = main.profileId;
    const assistA = await makeTechnician('C', 'assistant');
    ids.assistantAUser = assistA.userId;
    ids.assistantAProfile = assistA.profileId;
    const assistB = await makeTechnician('D', 'assistant');
    ids.assistantBUser = assistB.userId;
    ids.assistantBProfile = assistB.profileId;

    for (const assistantId of [ids.assistantAProfile, ids.assistantBProfile]) {
      await q(
        `INSERT INTO technician_services (technician_id,service_id,verification_status,is_active)
         VALUES ($1,$2,'approved',true)`,
        [assistantId, ids.service],
      );
      await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [
        assistantId,
        ids.zone,
      ]);
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

    // required_assistants=1 — شريحة واحدة بس، والاتنين هيحاولوا ياخدوها في نفس اللحظة.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, required_assistants)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned',10000,1) RETURNING id`,
      [`TEST-${runId}`.slice(0, 24), ids.customerProfile, ids.mainTechnicianProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    const expiresAt = new Date(Date.now() + 60_000);
    const [offerA] = await q(
      `INSERT INTO order_assistant_offers (order_id, assistant_technician_id, offer_status, sent_at, expires_at)
       VALUES ($1,$2,'sent',now(),$3) RETURNING id`,
      [ids.order, ids.assistantAProfile, expiresAt],
    );
    ids.offerA = offerA.id;
    const [offerB] = await q(
      `INSERT INTO order_assistant_offers (order_id, assistant_technician_id, offer_status, sent_at, expires_at)
       VALUES ($1,$2,'sent',now(),$3) RETURNING id`,
      [ids.order, ids.assistantBProfile, expiresAt],
    );
    ids.offerB = offerB.id;
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM order_assistant_offers WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [ids.assistantAProfile, ids.assistantBProfile]);
    await q(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [ids.assistantAProfile, ids.assistantBProfile]);
    await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2,$3)`, [
      ids.mainTechnicianProfile,
      ids.assistantAProfile,
      ids.assistantBProfile,
    ]);
    await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.mainTechnicianUser, ids.assistantAUser, ids.assistantBUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
    cache.onModuleDestroy();
  });

  it('مساعدين اتنين بيقبلوا نفس الشريحة الوحيدة في نفس اللحظة — واحد بس يفوز', async () => {
    const results = await Promise.allSettled([
      service.accept(ids.assistantAUser, ids.offerA),
      service.accept(ids.assistantBUser, ids.offerB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason as { getStatus: () => number };
    expect(rejectedReason.getStatus()).toBe(409);

    const teamMembers = await dataSource.query(`SELECT technician_id FROM order_team_members WHERE order_id = $1`, [ids.order]);
    expect(teamMembers).toHaveLength(1);
    expect([ids.assistantAProfile, ids.assistantBProfile]).toContain(teamMembers[0].technician_id);

    const offers = await dataSource.query(
      `SELECT assistant_technician_id, offer_status FROM order_assistant_offers WHERE order_id = $1`,
      [ids.order],
    );
    const winnerOffer = offers.find((o: { assistant_technician_id: string }) => o.assistant_technician_id === teamMembers[0].technician_id);
    expect(winnerOffer.offer_status).toBe(AssistantOfferStatus.ACCEPTED);
  });
});
