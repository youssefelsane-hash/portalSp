import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { BookingMode, Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { MatchingService } from './matching.service';

// اختبار حي ضد Postgres حقيقي (docs/08 §38، طلب مالك صريح 2026-08-21) — findEligibleTechnicians()
// (التوزيع التلقائي الفعلي) كانت زيرو فلترة بمستوى الفني لطلبات "اعتماد" — فني مستواه new كان
// ممكن يتوزّع عليه طلب اعتماد كقائد مهمة، رغم إن قايمة التصفّح اليدوي بتفلتره. الإصلاح بيوحّد
// المصدرين (نفس فلسفة decision_limit_cents الموثّقة في matching.service.ts).
describe('MatchingService.findEligibleTechnicians() — بوابة مستوى "اعتماد" (docs/08 §38)', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;

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
    newTechProfile: '',
    proTechProfile: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback) } as never),
      { getNumber: jest.fn(async (_key: string, fallback: number) => fallback) } as never,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اعتماد ${runId}`, `Test City ${runId}`, `test-city-team-${runId}`],
    );
    ids.city = city.id;

    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اعتماد ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اعتماد ${runId}`,
      `Test Category ${runId}`,
      `test-category-team-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اعتماد ${runId}`, `test-service-team-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2016${runId}`.slice(0, 14),
      `عميل اعتماد ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اعتماد ${runId}`],
    );
    ids.address = address.id;

    const makeTechnician = async (label: string, level: string) => {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2017${label}${runId}`.slice(0, 14),
        `فني اعتماد ${label} ${runId}`,
      ]);
      const [profile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1,$2,$3,'approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography)
         RETURNING id`,
        [user.id, `TMB${label}${runId}`.slice(0, 20), level],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`, [
        profile.id,
        ids.service,
      ]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
      return profile.id as string;
    };

    ids.newTechProfile = await makeTechnician('NEW', 'new');
    ids.proTechProfile = await makeTechnician('PRO', 'professional');
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const technicianIds = [ids.newTechProfile, ids.proTechProfile];
    try {
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [technicianIds]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [technicianIds]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianIds]);
      await q(`DELETE FROM users WHERE id IN (SELECT user_id FROM technician_profiles WHERE id = ANY($1::uuid[]))`, [technicianIds]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  const findCandidates = (bookingMode: BookingMode) => {
    const order = {
      id: randomUUID(),
      serviceId: ids.service,
      serviceZoneId: ids.zone,
      addressId: ids.address,
      scheduledAt: null,
      totalAmountCents: 10000,
      bookingMode,
    } as Order;
    return (
      matchingService as unknown as { findEligibleTechnicians: (...args: unknown[]) => Promise<{ technician_id: string }[]> }
    ).findEligibleTechnicians(order, 50, null, false, null);
  };

  it('اعتماد (TEAM) — فني new يتحجب، فني professional يترشّح', async () => {
    const candidates = await findCandidates(BookingMode.TEAM);
    expect(candidates.some((c) => c.technician_id === ids.newTechProfile)).toBe(false);
    expect(candidates.some((c) => c.technician_id === ids.proTechProfile)).toBe(true);
  });

  it('فردي (INDIVIDUAL) — الاتنين يترشّحوا (regression، صفر تأثير)', async () => {
    const candidates = await findCandidates(BookingMode.INDIVIDUAL);
    expect(candidates.some((c) => c.technician_id === ids.newTechProfile)).toBe(true);
    expect(candidates.some((c) => c.technician_id === ids.proTechProfile)).toBe(true);
  });
});
