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

// وزن الموثوقية في محرك المطابقة (docs/08 §36.20-21، ADR-0023) — اختبار حي ضد Postgres حقيقي.
// نفس نمط matching-fairness-scoring.spec.ts بالحرف (fixture/buildMatchingService/findCandidates).
// الافتراضي (reliability_weight=0) بيرجّع للسلوك القديم بالحرف — الاختبارات دي بتفعّل الإعداد
// صراحة عشان تتحقق من الميكانيزم نفسه.
describe('MatchingService.findEligibleTechnicians() — وزن الموثوقية (docs/08 §36.20-21، ADR-0023)', () => {
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

  async function makeTechnician(label: string, opts: { averageRating?: number; totalRatingsCount?: number } = {}): Promise<string> {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2016${label}${runId}`.slice(0, 14),
      `فني موثوقية ${label} ${runId}`,
    ]);
    cleanupUserIds.push(user.id as string);
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, current_location, average_rating, total_ratings_count)
       VALUES ($1,$2,'new','approved', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography, $3, $4) RETURNING id`,
      [user.id, `RELY${label}${runId}`.slice(0, 20), opts.averageRating ?? 0, opts.totalRatingsCount ?? 0],
    );
    cleanupTechnicianIds.push(profile.id as string);
    await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.service]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
    return profile.id as string;
  }

  function buildOrder(): Order {
    return {
      id: randomUUID(),
      serviceId: ids.service,
      serviceZoneId: ids.zone,
      addressId: ids.address,
      scheduledAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      totalAmountCents: 10000,
    } as Order;
  }

  async function findCandidates(
    service: MatchingService,
    order: Order,
  ): Promise<{ technician_id: string; rank_score: string; reliability_adjustment: string }[]> {
    return (
      service as unknown as {
        findEligibleTechnicians: (
          ...args: unknown[]
        ) => Promise<{ technician_id: string; rank_score: string; reliability_adjustment: string }[]>;
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
      [`دولة موثوقية ${runId}`, `Reliability Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    ))[0].id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة موثوقية ${runId}`, `Reliability City ${runId}`, `reliability-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق موثوقية ${runId}`,
      `Reliability Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة موثوقية ${runId}`,
      `Reliability Category ${runId}`,
      `reliability-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة موثوقية ${runId}`, `reliability-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2017${runId}`.slice(0, 14),
      `عميل موثوقية ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع موثوقية ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
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

  it('reliability_weight=0 (الافتراضي) — تقييم الفني مالوش أي أثر على الترتيب', async () => {
    const highRated = await makeTechnician('high-off', { averageRating: 5, totalRatingsCount: 20 });
    const lowRated = await makeTechnician('low-off', { averageRating: 2, totalRatingsCount: 20 });

    const service = buildMatchingService({});
    const candidates = await findCandidates(service, buildOrder());
    const highScore = candidates.find((c) => c.technician_id === highRated)?.rank_score;
    const lowScore = candidates.find((c) => c.technician_id === lowRated)?.rank_score;
    expect(Number(highScore)).toBe(Number(lowScore));
  });

  it('reliability_weight مفعّل — فني تقييمه أعلى من الأساس بياخد أولوية على فني تقييمه أقل', async () => {
    const highRated = await makeTechnician('high-on', { averageRating: 5, totalRatingsCount: 20 });
    const lowRated = await makeTechnician('low-on', { averageRating: 2, totalRatingsCount: 20 });

    const service = buildMatchingService({ 'matching.reliability_weight': 2, 'matching.reliability_baseline_rating': 4 });
    const candidates = await findCandidates(service, buildOrder());
    const ids_ = candidates.map((c) => c.technician_id);
    expect(ids_.indexOf(highRated)).toBeLessThan(ids_.indexOf(lowRated));
  });

  it('فني جديد بصفر تقييمات مبيتعاقبش رغم إن average_rating=0 — محايد تمامًا لو تحت الحد الأدنى', async () => {
    const newTech = await makeTechnician('brand-new', { averageRating: 0, totalRatingsCount: 0 });
    const averageTech = await makeTechnician('average', { averageRating: 4, totalRatingsCount: 20 });

    const service = buildMatchingService({
      'matching.reliability_weight': 2,
      'matching.reliability_baseline_rating': 4,
      'matching.reliability_min_ratings_count': 3,
    });
    const candidates = await findCandidates(service, buildOrder());
    const newScore = candidates.find((c) => c.technician_id === newTech)?.reliability_adjustment;
    const averageScore = candidates.find((c) => c.technician_id === averageTech)?.reliability_adjustment;
    expect(Number(newScore)).toBe(0);
    expect(Number(averageScore)).toBe(0); // بالظبط عند الأساس، فرق صفر
    // الأهم: الفني الجديد (صفر تقييمات) ميترتّبش تحت فني تقييمه واطي فعليًا (لو كان بيتعاقب كإنه "تقييمه صفر")
    const lowRatedButQualified = await makeTechnician('low-qualified', { averageRating: 1, totalRatingsCount: 10 });
    const candidates2 = await findCandidates(service, buildOrder());
    const ids_ = candidates2.map((c) => c.technician_id);
    expect(ids_.indexOf(newTech)).toBeLessThan(ids_.indexOf(lowRatedButQualified));
  });
});
