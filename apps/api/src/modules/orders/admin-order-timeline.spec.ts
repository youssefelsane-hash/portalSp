import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { AdminOrdersService } from './admin-orders.service';
import { Order, BookingMode } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';

// اختبار حي ضد Postgres حقيقي — Timeline موحّد لتفاصيل الطلب (Script 4 Part G §30-32).
// كانت فجوة موثّقة صراحة: 4 مصادر منفصلة (audit_logs, order_status_history, order_assignments,
// technician_order_cancellations) كل واحدة في كارت لوحدها، مفيش تسلسل زمني موحّد.
describe('AdminOrdersService.getTimeline() — Timeline موحّد', () => {
  let dataSource: DataSource;
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
    adminUserId: '',
    leaderProfile: '',
    leaderUser: '',
    cancellationReason: '',
    order: '',
  };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation],
    });
    await dataSource.initialize();

    // نطاق خدمة خاص بالملف ده، مش "SELECT ... LIMIT 1" مقترَض (كان بيسبب سباق حقيقي مع ملفات
    // jest تانية بتنشئ نطاقها وتحذفه على CI — راجع نفس الإصلاح في admin-crew-management.spec.ts).
    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة تايملاين ${runId}`,
      `Timeline City ${runId}`,
      `test-timeline-city-${runId}`,
    ]);
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق تايملاين ${runId}`,
      `Timeline Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    ids.city = city.id;
    ids.country = country.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تايملاين ${runId}`,
      `Timeline Category ${runId}`,
      `test-timeline-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [category.id, `خدمة تايملاين ${runId}`, `test-timeline-svc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2043${runId}`.slice(0, 15),
      `عميل تايملاين ${runId}`,
      `customer-tl-${runId}@test.local`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تايملاين ${runId}`],
    );
    ids.address = address.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2044${runId}`.slice(0, 15),
      `أدمن تايملاين ${runId}`,
    ]);
    users.push(adminUser.id);
    ids.adminUserId = adminUser.id;

    const [leaderUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2045${runId}`.slice(0, 15),
      `فني تايملاين ${runId}`,
    ]);
    users.push(leaderUser.id);
    ids.leaderUser = leaderUser.id;
    const [leaderProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status)
       VALUES ($1,$2,'x',3,'new','approved') RETURNING id`,
      [leaderUser.id, `TCTL${runId}`.slice(0, 20)],
    );
    ids.leaderProfile = leaderProfile.id;

    const [reason] = await q(
      `INSERT INTO cancellation_reasons (reason_ar, reason_en, applies_to) VALUES ($1,$2,'technician') RETURNING id`,
      [`سبب تايملاين ${runId}`, `Timeline Reason ${runId}`],
    );
    ids.cancellationReason = reason.id;

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0,'individual') RETURNING id`,
      [`TESTTL-${runId}`.slice(0, 24), ids.customerProfile, ids.leaderProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    adminOrdersService = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      {} as never, // techniciansService — مش متنادى في getTimeline
      {} as never, // assignmentGuard
      new EventEmitter2(),
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never, // pricingEngineService
      {} as never, // promoCodesService
      {} as never, // settingsService (docs/08 §35) — مش متنادى (الاختبار ده بيمتحن getTimeline() بس)
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM technician_order_cancellations WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM audit_logs WHERE entity_id = $1`, [ids.order]);
      await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM cancellation_reasons WHERE id = $1`, [ids.cancellationReason]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.leaderProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('يرجّع الأحداث من الـ4 مصادر مرتّبة زمنيًا، مع اسم الفاعل جاهز', async () => {
    // ترتيب الإدخال متعمّد بالعكس (أحدث الأحداث الحقيقية أولاً في وقت الإدخال) عشان الاختبار
    // يثبت إن الترتيب في النتيجة معتمد على ts الفعلي مش على ترتيب الإدخال في الداتابيز.
    await q(
      `INSERT INTO technician_order_cancellations
         (order_id, technician_id, technician_user_id, cancellation_reason_id, booking_mode, accepted_at, cancelled_at, elapsed_seconds_after_acceptance, within_policy_window, recovery_action, fee_cents)
       VALUES ($1,$2,$3,$4,'individual', now() - interval '3 hours', now() - interval '4 minutes', 60, true, 'rematch', 0)`,
      [ids.order, ids.leaderProfile, ids.leaderUser, ids.cancellationReason],
    );

    await q(
      `INSERT INTO order_status_history (order_id, previous_status, new_status, changed_by_user_id, changed_by_role, change_source, reason, created_at)
       VALUES ($1,'searching_technician','technician_assigned',$2,'admin','admin','تعيين يدوي', now() - interval '5 hours')`,
      [ids.order, ids.adminUserId],
    );

    await q(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, new_values, created_at)
       VALUES ($1,'admin','order.rescheduled_by_admin','order',$2,$3, now() - interval '2 hours')`,
      [ids.adminUserId, ids.order, JSON.stringify({ reason: 'اختبار' })],
    );

    await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'accepted', now() - interval '6 hours', now() - interval '5 hours 50 minutes')`,
      [ids.order, ids.leaderProfile],
    );

    const timeline = await adminOrdersService.getTimeline(ids.order);
    expect(timeline.length).toBeGreaterThanOrEqual(4);

    const sources = timeline.map((e) => e.source);
    expect(sources).toContain('status_history');
    expect(sources).toContain('audit_log');
    expect(sources).toContain('assignment');
    expect(sources).toContain('technician_cancellation');

    // مرتّب تصاعديًا زمنيًا — أول حدث (assignment، قبل 6 ساعات) لازم يسبق آخر حدث (cancellation، قبل 4 دقايق).
    const timestamps = timeline.map((e) => e.ts.getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
    expect(sources[0]).toBe('assignment');
    expect(sources[sources.length - 1]).toBe('technician_cancellation');

    const statusEvent = timeline.find((e) => e.source === 'status_history')!;
    expect(statusEvent.actorFullName).toContain('أدمن تايملاين');
    expect(statusEvent.actorUserType).toBe('admin');
    expect(statusEvent.detail).toMatchObject({ new_status: 'technician_assigned' });

    const auditEvent = timeline.find((e) => e.source === 'audit_log')!;
    expect(auditEvent.title).toBe('order.rescheduled_by_admin');
    expect(auditEvent.actorFullName).toContain('أدمن تايملاين');
  });

  it('docs/08 §35.14 — بيشمل فرص العمل/التجنيد وتصعيد نقص الطاقم (صفر جدول جديد)', async () => {
    await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, context, crew_role, capacity_tier_at_offer, status, offered_at)
       VALUES ($1,$2,'crew_recruit','technician','MEANINGFUL','offered', now() - interval '1 hour')`,
      [ids.order, ids.leaderProfile],
    );
    await q(`UPDATE orders SET crew_shortage_escalated_at = now() - interval '30 minutes' WHERE id = $1`, [ids.order]);

    const timeline = await adminOrdersService.getTimeline(ids.order);
    const sources = timeline.map((e) => e.source);
    expect(sources).toContain('work_opportunity');
    expect(sources).toContain('crew_shortage_escalation');

    const opportunityEvent = timeline.find((e) => e.source === 'work_opportunity')!;
    expect(opportunityEvent.detail).toMatchObject({ context: 'crew_recruit', crew_role: 'technician', status: 'offered' });

    await q(`UPDATE orders SET crew_shortage_escalated_at = NULL WHERE id = $1`, [ids.order]);
  });

  it('يرجّع مصفوفة فاضية لطلب مفيهوش أي أحداث لسه', async () => {
    const [freshOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','pending',30000,0,'individual') RETURNING id`,
      [`TESTTL-empty-${runId}`.slice(0, 24), ids.customerProfile, null, ids.service, ids.address, ids.zone],
    );
    const timeline = await adminOrdersService.getTimeline(freshOrder.id);
    expect(timeline).toEqual([]);
    await q(`DELETE FROM orders WHERE id = $1`, [freshOrder.id]);
  });

  it('يرفض طلب مش موجود', async () => {
    await expect(adminOrdersService.getTimeline('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
  });
});
