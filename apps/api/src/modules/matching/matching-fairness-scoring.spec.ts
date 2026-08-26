import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

// نموذج العدالة بالتاريخ الحديث + كسر التعادل (docs/08 §34.2، ADR-0020 §6) — اختبار حي ضد
// Postgres حقيقي. الافتراضي (fairness_weight=0, tie_break_threshold=0) بيرجّع للسلوك القديم
// بالحرف (اتأكّد فعليًا في matching-workload-balance.spec.ts، بلا تغيير هنا) — الاختبارات دي
// بتفعّل الإعدادات صراحة عشان تتحقق من الميكانيزم نفسه.
describe('MatchingService.findEligibleTechnicians() — نموذج العدالة (docs/08 §34.2)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
  };
  const cleanupOrderIds: string[] = [];
  const cleanupTechnicianIds: string[] = [];
  const cleanupUserIds: string[] = [];

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  function buildMatchingService(settingsOverrides: Record<string, number>): MatchingService {
    const settingsService = {
      getNumber: jest.fn(async (key: string, fallback: number) => settingsOverrides[key] ?? fallback), getString: jest.fn(async (_k: string, fb: string) => fb)
    };
    return new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService(settingsService as never),
      settingsService as never,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );
  }

  async function makeTechnician(label: string, level: string = 'new'): Promise<string> {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2014${label}${runId}`.slice(0, 14),
      `فني عدالة ${label} ${runId}`,
    ]);
    cleanupUserIds.push(user.id as string);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status, current_location)
       VALUES ($1,$2,$3,'approved', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [user.id, `FAIR${label}${runId}`.slice(0, 20), level],
    );
    cleanupTechnicianIds.push(profile.id as string);
    await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.service]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
    return profile.id as string;
  }

  async function insertRecentAssignedOrder(technicianId: string): Promise<void> {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, assigned_at, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,'completed', now() - interval '1 day', now() - interval '1 day') RETURNING id`,
      [`FAIRDONE-${cleanupOrderIds.length}-${runId}`.slice(0, 24), ids.customerProfile, technicianId, ids.service, ids.address, ids.zone],
    );
    cleanupOrderIds.push(order.id as string);
  }

  async function insertRecentDeclinedOpportunity(technicianId: string): Promise<void> {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status)
       VALUES ($1,$2,$3,$4,$5,'searching_technician') RETURNING id`,
      [`FAIRDECL-${cleanupOrderIds.length}-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    cleanupOrderIds.push(order.id as string);
    await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status, offered_at, decided_at)
       VALUES ($1,$2,'MEANINGFUL','declined', now() - interval '1 day', now() - interval '1 day')`,
      [order.id, technicianId],
    );
  }

  function buildOrder(): Order {
    return {
      id: randomUUID(),
      serviceId: ids.service,
      serviceZoneId: ids.zone,
      addressId: ids.address,
      scheduledAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      // قيمة رمزية صغيرة تحت حد قرار مستوى 'new' (200 جنيه) — كل فنيي الاختبار ده 'new' افتراضيًا
      // إلا لو صرّحوا بمستوى تاني، والاختبارات هنا بتفحص ترتيب العدالة مش حدود القرار السعرية
      // (docs/08 §36.1 تعميق — findEligibleTechnicians بقت بتفحص decision_limit_cents).
      totalAmountCents: 10000,
    } as Order;
  }

  async function findCandidates(service: MatchingService, order: Order): Promise<{ technician_id: string; rank_score: string }[]> {
    return (
      service as unknown as {
        findEligibleTechnicians: (...args: unknown[]) => Promise<{ technician_id: string; rank_score: string }[]>;
      }
    ).findEligibleTechnicians(order, 50, null, false, null);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country?.id ?? (await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة عدالة ${runId}`, `Fair Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    ))[0].id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة عدالة ${runId}`, `Fair City ${runId}`, `fair-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق عدالة ${runId}`,
      `Fair Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة عدالة ${runId}`,
      `Fair Category ${runId}`,
      `fair-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة عدالة ${runId}`, `fair-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2015${runId}`.slice(0, 14),
      `عميل عدالة ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع عدالة ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1::uuid[])`, [cleanupOrderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [cleanupOrderIds]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [cleanupTechnicianIds]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [cleanupTechnicianIds]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [cleanupTechnicianIds]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [cleanupUserIds]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('فني اتاخد له شغل كتير الأسبوع ده مقابل فني معندوش حاجة — الأقل استغلالاً بياخد أفضلية عادلة لما fairness_weight مفعّل', async () => {
    const busyTech = await makeTechnician('busy');
    const idleTech = await makeTechnician('idle');
    for (let i = 0; i < 3; i += 1) await insertRecentAssignedOrder(busyTech);

    const service = buildMatchingService({ 'matching.fairness_weight': 5, 'matching.fairness_lookback_days': 7 });
    const candidates = await findCandidates(service, buildOrder());
    const ids_ = candidates.map((c) => c.technician_id);
    expect(ids_.indexOf(idleTech)).toBeLessThan(ids_.indexOf(busyTech));
  });

  it('فني رفض فرص كتير حديثًا مايحتفظش بأفضلية "معندوش شغل" مصطنعة', async () => {
    const declinerTech = await makeTechnician('decliner');
    const trulyIdleTech = await makeTechnician('truly-idle');
    for (let i = 0; i < 4; i += 1) await insertRecentDeclinedOpportunity(declinerTech);

    const service = buildMatchingService({
      'matching.fairness_weight': 5,
      'matching.fairness_lookback_days': 7,
      'matching.fairness_decline_weight': 0.5,
    });
    const candidates = await findCandidates(service, buildOrder());
    const ids_ = candidates.map((c) => c.technician_id);
    expect(ids_.indexOf(trulyIdleTech)).toBeLessThan(ids_.indexOf(declinerTech));
  });

  it('fairness_weight=0 (الافتراضي) — الرفض الحديث مالوش أي أثر على الترتيب', async () => {
    const declinerTech = await makeTechnician('decliner-off');
    const idleTech = await makeTechnician('idle-off');
    for (let i = 0; i < 4; i += 1) await insertRecentDeclinedOpportunity(declinerTech);

    const service = buildMatchingService({});
    const candidates = await findCandidates(service, buildOrder());
    const declinerScore = candidates.find((c) => c.technician_id === declinerTech)?.rank_score;
    const idleScore = candidates.find((c) => c.technician_id === idleTech)?.rank_score;
    expect(Number(declinerScore)).toBe(Number(idleScore));
  });

  it('كسر التعادل الموزون — مرشحين متعادلين تمامًا مش دايمًا بنفس الترتيب عبر نداءات متكررة', async () => {
    const techX = await makeTechnician('tieX');
    const techY = await makeTechnician('tieY');

    const service = buildMatchingService({ 'matching.tie_break_threshold': 1000 });
    const winners = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const candidates = await findCandidates(service, buildOrder());
      const relevant = candidates.filter((c) => c.technician_id === techX || c.technician_id === techY);
      winners.add(relevant[0]?.technician_id);
    }
    // مع 20 محاولة وفرصة 50/50 لكل مرشّح، احتمال إن نفس الفني يفوز في كل الـ20 مرة تقريبًا صفر —
    // شوف الاتنين ظهروا الأول على الأقل مرة واحدة يثبت إن الترتيب مش حتمي صارم.
    expect(winners.size).toBe(2);
  });

  it('tie_break_threshold=0 (الافتراضي) — الترتيب حتمي صارم، مفيش تشويش خالص', async () => {
    const techP = await makeTechnician('detP');
    const techQ = await makeTechnician('detQ');

    const service = buildMatchingService({});
    const orders: string[][] = [];
    for (let i = 0; i < 5; i += 1) {
      const candidates = await findCandidates(service, buildOrder());
      orders.push(candidates.filter((c) => c.technician_id === techP || c.technician_id === techQ).map((c) => c.technician_id));
    }
    for (const order of orders) expect(order).toEqual(orders[0]);
  });

  it('فرق مستوى/جودة كبير لسه بيغلب أفضلية العدالة الصغيرة (بند S/17 من رسالة المالك)', async () => {
    // فني "premium" (order_priority_weight=30) عنده شغل حديث كتير، مقابل فني "new" (weight=0)
    // معندوش أي شغل حديث خالص. لو العدالة كانت بتلغي فرق المستوى بالكامل، الفني الجديد كان
    // هيفوز رغم فرق الجودة الكبير — ده بالظبط اللي المطلوب يتجنّبه.
    const premiumTech = await makeTechnician('premium', 'premium');
    const newTech = await makeTechnician('newbie', 'new');
    for (let i = 0; i < 3; i += 1) await insertRecentAssignedOrder(premiumTech);

    const service = buildMatchingService({ 'matching.fairness_weight': 5, 'matching.fairness_lookback_days': 7 });
    const candidates = await findCandidates(service, buildOrder());
    const ids_ = candidates.map((c) => c.technician_id);
    // فرق المستوى (30) أكبر بكتير من أثر العدالة القصوى المعقول هنا (5 وزن × 3 طلبات = 15)،
    // فالـpremium (رغم انشغاله الحديث) لازم يفضل الأول.
    expect(ids_.indexOf(premiumTech)).toBeLessThan(ids_.indexOf(newTech));
  });
});
