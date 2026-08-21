import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import { Order, OrderStatus, BookingMode } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { CancellationAppliesTo } from './entities/cancellation-reason.entity';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { TechniciansService } from '../technicians/technicians.service';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../audit/audit-log.service';

// اختبار حي ضد Postgres حقيقي — بَقّة حقيقية اتلقطت من اختبار المالك الفعلي لتطبيق الفني
// (docs/08 §بند إصلاح إلغاء قائد طلب "اعتماد"، 2026-08-21): canSelfCancelTeamOrder() كانت
// بتفحص الرتبة الشخصية للفني في شركته الدائمة (TechnicianTeamRole، من technician_companies)
// بدل الاعتماد على إثبات القيادة الفعلي لهذا الطلب بالذات (orders.technician_id) اللي
// findOwnedByTechnicianOrThrow() بيثبته أصلاً قبل ما نوصل لأي فحص. النتيجة: فني هو قائد الطلب
// الحقيقي (orders.technician_id يساويه) كان بيترفض بـ"لازم يعدّي من مدير الفريق" لمجرد إن
// عنده team_role='worker' في شركته المنفصلة — قرار مش له علاقة بقيادته لهذا الطلب. الإصلاح:
// findOwnedByTechnicianOrThrow() نفسه هو الإثبات الوحيد المطلوب — تم حذف الفحص الإضافي بالكامل
// من getTechnicianCancellationPolicy() و technicianCancel()، ونفس المبدأ في ADR-0021/ADR-0022
// (قائد الطلب عنده صلاحية كاملة بلا بوابة رتبة شركة).
describe('OrdersService — إلغاء قائد طلب فريق بنفسه رغم رتبته الشخصية "عادي" في شركته (docs/08، بَقّة 2026-08-21)', () => {
  let dataSource: DataSource;
  let service: OrdersService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    company: '',
    technicianUser: '',
    technicianProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    order: '',
    cancellationReasonId: '019fe079-9264-7ab2-9133-5e72530ec783', // "الفني مش قدر يوصل" — technician/بلا رسوم/بلا نص حر إجباري (مصدر: cancellation_reasons المزروعة)
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, TechnicianOrderCancellation],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    ids.country = country.id;

    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة قيادة ${runId}`,
      `Leader Cancel City ${runId}`,
      `test-leader-cancel-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق قيادة ${runId}`,
      `Leader Cancel Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة قيادة ${runId}`,
      `Leader Cancel Category ${runId}`,
      `test-leader-cancel-category-${runId}`,
    ]);
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',30000) RETURNING id`,
      [ids.category, `خدمة قيادة ${runId}`, `test-leader-cancel-service-${runId}`],
    );
    ids.service = serviceRow.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2013${runId}`.slice(0, 15),
      `عميل قيادة ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع قيادة ${runId}`],
    );
    ids.address = address.id;

    // شركة دائمة للفني — منفصلة تمامًا عن قيادته لهذا الطلب بالذات، رتبته فيها "عادي" (worker) عمدًا.
    const [company] = await q(`INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`, [
      ids.customerUser,
      `شركة قيادة ${runId}`,
    ]);
    ids.company = company.id;

    const [technicianUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2014${runId}`.slice(0, 15),
      `فني قيادة ${runId}`,
    ]);
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, current_location, company_id, team_role)
       VALUES ($1,$2,'professional','approved',true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography, $3, 'worker')
       RETURNING id`,
      [ids.technicianUser, `TSTLDR${runId}`.slice(0, 20), ids.company],
    );
    ids.technicianProfile = technicianProfile.id;

    // طلب "اعتماد" (فريق) — الفني ده هو orders.technician_id بالذات (قائد الطلب الفعلي)،
    // مقبول من دقيقة واحدة (جوّه نافذة الإلغاء)، ASAP (بلا scheduled_at) عشان نتجنب فحص الموعد.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
         order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, accepted_at, placed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0,'team', now() - interval '1 minute', now()) RETURNING id`,
      [`TESTLDRCXL-${runId}`.slice(0, 24), ids.customerProfile, ids.technicianProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    const settingsServiceStub = {
      getBoolean: async (_key: string, fallback: boolean) => (_key === 'cancellation.technician_self_cancel_enabled' ? true : fallback),
      getNumber: async (_key: string, fallback: number) => fallback,
    } as unknown as SettingsService;

    const cancellationReasonsServiceStub = {
      findOrThrow: async (id: string) => ({
        id,
        appliesTo: CancellationAppliesTo.TECHNICIAN,
        requiresFreeText: false,
        chargesFee: false,
        feePercentage: 0,
        reasonAr: 'الفني مش قدر يوصل',
      }),
    } as unknown as CancellationReasonsService;

    const techniciansServiceStub = {
      findByUserIdOrThrow: async (userId: string) => ({ id: ids.technicianProfile, userId }),
    } as unknown as TechniciansService;

    const auditLogStub = { record: async () => undefined } as unknown as AuditLogService;
    const eventsStub = { emit: () => undefined } as unknown as EventEmitter2;

    service = new OrdersService(
      dataSource.getRepository(Order),
      {} as never, // technicianOrderCancellations repo — مش مستخدم مباشرة، الكود بيعمل manager.create()
      {} as never, // orderMedia repo
      dataSource,
      auditLogStub,
      {} as never, // customerProfiles
      {} as never, // addressesService
      {} as never, // catalogService
      {} as never, // geoService
      techniciansServiceStub,
      {} as never, // technicianCompaniesService
      {} as never, // scheduleService
      {} as never, // pricingEngineService
      {} as never, // promoCodesService
      {} as never, // buildingsService
      cancellationReasonsServiceStub,
      {} as never, // walletsService — مش مستخدمة، السبب هنا بلا رسوم (chargesFee: false)
      settingsServiceStub,
      {} as never, // paymentsService
      {} as never, // supportService
      eventsStub,
      {} as never, // orderTeamService
      {} as never, // domesticWorkersService (ADR-0029)
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM technician_order_cancellations WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.technicianUser]);
    await q(`DELETE FROM technician_companies WHERE id = $1`, [ids.company]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('getTechnicianCancellationPolicy() — can_cancel: true رغم team_role="worker" الشخصية (مش مرتبطة بقيادة الطلب)', async () => {
    const policy = await service.getTechnicianCancellationPolicy(ids.technicianUser, ids.order);
    expect(policy.can_cancel).toBe(true);
    expect(policy.reason_if_not).toBeNull();
  });

  it('technicianCancel() — ينجح فعليًا للقائد الحقيقي بلا حاجة لإذن "مدير الفريق"', async () => {
    const cancelled = await service.technicianCancel(ids.technicianUser, ids.order, {
      cancellation_reason_id: ids.cancellationReasonId,
    });
    expect(cancelled.orderStatus).not.toBe(OrderStatus.ACCEPTED);
    expect([OrderStatus.SEARCHING_TECHNICIAN, OrderStatus.AWAITING_TECHNICIAN_RESELECTION]).toContain(cancelled.orderStatus);
    expect(cancelled.technicianId).toBeNull();

    const [cancellationRow] = await dataSource.query(`SELECT technician_id, booking_mode FROM technician_order_cancellations WHERE order_id = $1`, [
      ids.order,
    ]);
    expect(cancellationRow).toMatchObject({ technician_id: ids.technicianProfile, booking_mode: BookingMode.TEAM });
  });
});
