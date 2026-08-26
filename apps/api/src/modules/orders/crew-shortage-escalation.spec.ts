import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { CrewShortageEscalationService } from './crew-shortage-escalation.service';
import { OrderTeamService } from './order-team.service';
import { AdminOrdersService } from './admin-orders.service';
import { Order, BookingMode, OrderStatus } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { User } from '../auth/entities/user.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile, TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { SettingsService } from '../settings/settings.service';
import { ORDER_CREW_SHORTAGE_ESCALATED_EVENT, OrderCrewShortageEscalatedEvent } from '../../common/events/order-crew-shortage-escalated.event';

// اختبار حي ضد Postgres حقيقي — تصعيد نقص طاقم قبل الموعد (docs/08 §35.5، ADR-0021). عتبة
// التصعيد ثابتة 24 ساعة هنا (settingsServiceStub بيرجّع fallback دايمًا)، نفس الافتراضي الحقيقي
// في migration 0156.
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

describe('CrewShortageEscalationService — تصعيد نقص الطاقم قبل الموعد (docs/08 §35.5)', () => {
  let dataSource: DataSource;
  let escalationService: CrewShortageEscalationService;
  let orderTeamService: OrderTeamService;
  let adminOrdersService: AdminOrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    zone: '',
    city: '',
    country: '',
    category: '',
    service: '',
    customerProfile: '',
    address: '',
    leaderProfile: '',
    memberProfile: '',
  };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertOrder(
    label: string,
    opts: {
      requiredTechnicians: number;
      scheduledInHours: number;
      orderStatus?: OrderStatus;
      alreadyEscalated?: boolean;
      bookingMode?: BookingMode;
    },
  ) {
    const scheduledAt = new Date(Date.now() + opts.scheduledInHours * 60 * 60 * 1000);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians, required_assistants, scheduled_at, crew_shortage_escalated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,0,$8,$9,0,$10,$11) RETURNING id`,
      [
        `TESTESC-${label}`.slice(0, 24),
        ids.customerProfile,
        ids.leaderProfile,
        ids.service,
        ids.address,
        ids.zone,
        opts.orderStatus ?? OrderStatus.TECHNICIAN_ASSIGNED,
        opts.bookingMode ?? BookingMode.TEAM,
        opts.requiredTechnicians,
        scheduledAt,
        opts.alreadyEscalated ? new Date() : null,
      ],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderTeamMember, OrderStatusHistory, TechnicianOrderCancellation, User, TechnicianProfile, TechnicianCompany],
    });
    await dataSource.initialize();

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة تصعيد ${runId}`,
      `Escalation City ${runId}`,
      `test-escalation-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تصعيد ${runId}`,
      `Escalation Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تصعيد ${runId}`,
      `Escalation Category ${runId}`,
      `test-escalation-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة تصعيد ${runId}`, `test-escalation-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2045${runId}`.slice(0, 15),
      `عميل تصعيد ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تصعيد ${runId}`],
    );
    ids.address = address.id;

    const [leaderUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2046${runId}`.slice(0, 15),
      `قائد تصعيد ${runId}`,
    ]);
    users.push(leaderUser.id);
    const [leaderProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,$3,'approved',true) RETURNING id`,
      [leaderUser.id, `TCESC${runId}`.slice(0, 20), TechnicianLevel.PROFESSIONAL],
    );
    ids.leaderProfile = leaderProfile.id;

    const [memberUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2047${runId}`.slice(0, 15),
      `عضو تصعيد ${runId}`,
    ]);
    users.push(memberUser.id);
    const [memberProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [memberUser.id, `TCESCM${runId}`.slice(0, 20)],
    );
    ids.memberProfile = memberProfile.id;

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
    const assignmentGuard = new TechnicianAssignmentGuardService(settingsServiceStub);
    const workOpportunities = new TechnicianWorkOpportunitiesService(dataSource);

    orderTeamService = new OrderTeamService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderTeamMember),
      techniciansService,
      assignmentGuard,
      workOpportunities,
      settingsServiceStub,
      new EventEmitter2(),
    );

    escalationService = new CrewShortageEscalationService(
      dataSource.getRepository(Order),
      dataSource,
      settingsServiceStub,
      orderTeamService,
      new EventEmitter2(),
    );

    adminOrdersService = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      techniciansService,
      {} as never, // assignmentGuard — مش متنادى في getDetail()
      new EventEmitter2(),
      {} as unknown as AuditLogService,
      { findEvaluationForOrder: async () => null } as never, // pricingEngineService
      {} as never, // promoCodesService
      settingsServiceStub,
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_team_members WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTESC-%`]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTESC-%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTESC-%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.leaderProfile, ids.memberProfile]]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('sweep() — طلب فريق ناقص طاقم وموعده خلال 24 ساعة بيتصعّد، وبيبعت الحدث مرة واحدة بس', async () => {
    const orderId = await insertOrder('near-incomplete', { requiredTechnicians: 2, scheduledInHours: 2 });

    const events: OrderCrewShortageEscalatedEvent[] = [];
    const listener = (e: OrderCrewShortageEscalatedEvent) => events.push(e);
    (escalationService as unknown as { events: EventEmitter2 }).events.on(ORDER_CREW_SHORTAGE_ESCALATED_EVENT, listener);

    const firstSweepCount = await escalationService.sweep();
    expect(firstSweepCount).toBeGreaterThanOrEqual(1);
    expect(events.length).toBe(1);
    expect(events[0].orderId).toBe(orderId);
    expect(events[0].missingTechnicians).toBe(1);

    const [row] = await q(`SELECT crew_shortage_escalated_at FROM orders WHERE id = $1`, [orderId]);
    expect(row.crew_shortage_escalated_at).not.toBeNull();

    // idempotency — تشغيل ثاني للـ sweep ميعيدش تصعيد نفس الطلب ولا يبعت حدث تاني.
    await escalationService.sweep();
    expect(events.length).toBe(1);

    (escalationService as unknown as { events: EventEmitter2 }).events.off(ORDER_CREW_SHORTAGE_ESCALATED_EVENT, listener);
  });

  it('sweep() — طلب طاقمه كامل (required_technicians=1، القائد بس كافي) ميتصعّدش حتى لو موعده قريب', async () => {
    const orderId = await insertOrder('near-complete', { requiredTechnicians: 1, scheduledInHours: 3 });
    await escalationService.sweep();
    const [row] = await q(`SELECT crew_shortage_escalated_at FROM orders WHERE id = $1`, [orderId]);
    expect(row.crew_shortage_escalated_at).toBeNull();
  });

  it('sweep() — طلب ناقص طاقم لكن موعده بعيد (72 ساعة) مش بيتصعّد لسه', async () => {
    const orderId = await insertOrder('far-incomplete', { requiredTechnicians: 2, scheduledInHours: 72 });
    await escalationService.sweep();
    const [row] = await q(`SELECT crew_shortage_escalated_at FROM orders WHERE id = $1`, [orderId]);
    expect(row.crew_shortage_escalated_at).toBeNull();
  });

  it('sweep() — طلب فردي (booking_mode=individual) مش بيتصعّد حتى لو required_technicians ناقص نظريًا', async () => {
    const orderId = await insertOrder('individual', { requiredTechnicians: 2, scheduledInHours: 2, bookingMode: BookingMode.INDIVIDUAL });
    await escalationService.sweep();
    const [row] = await q(`SELECT crew_shortage_escalated_at FROM orders WHERE id = $1`, [orderId]);
    expect(row.crew_shortage_escalated_at).toBeNull();
  });

  it('sweep() — طلب اتصعّد بالفعل (crew_shortage_escalated_at متسجّل مسبقًا) ميتلمسش تاني', async () => {
    const orderId = await insertOrder('already-escalated', { requiredTechnicians: 2, scheduledInHours: 2, alreadyEscalated: true });
    const [before] = await q(`SELECT crew_shortage_escalated_at FROM orders WHERE id = $1`, [orderId]);
    await escalationService.sweep();
    const [after] = await q(`SELECT crew_shortage_escalated_at FROM orders WHERE id = $1`, [orderId]);
    expect(after.crew_shortage_escalated_at.getTime()).toBe(before.crew_shortage_escalated_at.getTime());
  });

  it('AdminOrdersService.getDetail() — crew_shortage_urgent = true لطلب ناقص طاقم قريب الموعد', async () => {
    const orderId = await insertOrder('urgent-detail', { requiredTechnicians: 2, scheduledInHours: 5 });
    const detail = await adminOrdersService.getDetail(orderId);
    expect(detail.crewStatus?.crewComplete).toBe(false);
    expect(detail.crewShortageUrgent).toBe(true);
  });

  it('AdminOrdersService.getDetail() — crew_shortage_urgent = false لطلب ناقص طاقم لكن موعده بعيد', async () => {
    const orderId = await insertOrder('not-urgent-detail', { requiredTechnicians: 2, scheduledInHours: 72 });
    const detail = await adminOrdersService.getDetail(orderId);
    expect(detail.crewStatus?.crewComplete).toBe(false);
    expect(detail.crewShortageUrgent).toBe(false);
  });

  it('AdminOrdersService.getDetail() — crew_shortage_urgent = false لطلب طاقمه كامل حتى لو موعده قريب', async () => {
    const orderId = await insertOrder('complete-detail', { requiredTechnicians: 1, scheduledInHours: 5 });
    const detail = await adminOrdersService.getDetail(orderId);
    expect(detail.crewStatus?.crewComplete).toBe(true);
    expect(detail.crewShortageUrgent).toBe(false);
  });
});
