import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { BookingMatchPreview } from './entities/booking-match-preview.entity';
import { bookingContextHashWithoutProvider, bookingMatchContextHash, bookingPreviewInputFromCreate } from './booking-match-context';
import { Payment } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { PaymentsService } from '../payments/payments.service';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { Address } from '../customers/entities/address.entity';
import { AddressesService } from '../customers/addresses.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { ServicePricingTierPricing } from '../catalog/entities/service-pricing-tier-pricing.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';
import { GeoService } from '../geo/geo.service';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { MatchingService } from '../matching/matching.service';
import { OrderAssignment } from '../matching/entities/order-assignment.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { SupportService } from '../support/support.service';
import { Complaint } from '../support/entities/complaint.entity';
import { ComplaintMessage } from '../support/entities/complaint-message.entity';
import { ComplaintAttachment } from '../support/entities/complaint-attachment.entity';

/**
 * **اختبار المالك المسمّى بالحرف** (ADR-0065، docs/08 §115 «المتبقي بالترتيب» بند 1):
 *
 * > «أحمد ظهر بسعر 330، أصبح غير متاح، التأكيد لا يحجز محمد ولا يغير السعر، بل يطلب Preview
 * > وتأكيدًا جديدين.»
 *
 * الاختبار بيغطي الجزئين اللي كانوا مكسورين:
 * - **التأكيد** (`OrdersService.create`) — كان بيتحقق من التذكرة بس، مش من الفني نفسه، فالطلب
 *   كان بيتعمل على فني مرفوض أصلاً من محرك المطابقة.
 * - **التوزيع** (`MatchingService.dispatchNextRound`) — كان بيرجع لمحمد بصمت بعد ما أحمد يفشل.
 */
describe('قفل المنفّذ — أحمد بسعر 330 بقى غير متاح: لا محمد ولا سعر جديد (ADR-0065)', () => {
  jest.setTimeout(90_000);

  let dataSource: DataSource;
  let cache: RedisCacheService;
  let ordersService: OrdersService;
  let matchingService: MatchingService;
  const runId = Date.now().toString(36);
  // 330 ج بالظبط زي سيناريو المالك. المستوى `professional` عشان حد القرار (1500 ج) يستوعبه —
  // نفس الفلترة اللي `findEligibleTechnicians()` بتعملها وقت المعاينة الحقيقية.
  const AHMED_PRICE_CENTS = 33_000;
  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    ahmedUser: '',
    ahmedTech: '',
    mohamedUser: '',
    mohamedTech: '',
    blockerOrder: '',
  };

  const auditRecords: {
    action: string;
    actorRole?: string | null;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
  }[] = [];
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** يوم الحجز — بعيد بما يكفي عن النهاردة عشان قواعد «الشغل القريب» ماتدخلش في النتيجة. */
  const bookingDay = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 10);
    return d.toISOString().slice(0, 10);
  };

  /** تذكرة معاينة حقيقية لفني بعينه — نفس دوال البصمة اللي `create()` هتقارن بيها بالظبط. */
  async function seedPreview(technicianId: string): Promise<BookingMatchPreview> {
    const dto = { service_id: ids.service, address_id: ids.address, scheduled_at: bookingDay() } as never;
    const previewInput = bookingPreviewInputFromCreate({
      ...(dto as Record<string, unknown>),
      requested_technician_id: technicianId,
    } as never);
    return dataSource.getRepository(BookingMatchPreview).save(
      dataSource.getRepository(BookingMatchPreview).create({
        customerId: ids.customerProfile,
        orderId: null,
        serviceId: ids.service,
        addressId: ids.address,
        technicianId,
        technicianCompanyId: null,
        selectionMode: 'manual',
        contextHash: bookingMatchContextHash(previewInput, 'manual', technicianId),
        bookingContextHash: bookingContextHashWithoutProvider(previewInput),
        pricingSnapshot: {} as never,
        finalPriceCents: AHMED_PRICE_CENTS,
        status: 'active',
        expiresAt: new Date(Date.now() + 10 * 60_000),
        consumedAt: null,
      }),
    );
  }

  /** «أحمد بقى مشغول» — شغل يوم كامل في نفس اليوم المطلوب، أوضح سبب واقعي لعدم التوافر. */
  async function makeAhmedBusy(): Promise<string> {
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, order_type, booking_mode,
                            order_status, scheduled_at, estimated_duration_days, total_amount_cents, payment_status, placed_at, source_channel)
       VALUES ($1,$2,$3,$4,$5,'standard','individual','accepted',$6,1,10000,'unpaid', now(), 'customer_app') RETURNING id`,
      [orderNumber, ids.customerProfile, ids.ahmedTech, ids.service, ids.address, `${bookingDay()}T09:00:00Z`],
    );
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order, OrderStatusHistory, BookingMatchPreview, OrderAssignment, Payment, Refund, User, WebhookEvent,
        Wallet, WalletTransaction, CustomerProfile, Address, City, Area, ServiceZone, TechnicianProfile,
        TechnicianCompany, TechnicianScheduleSlot, Setting, Complaint, ComplaintMessage, ComplaintAttachment,
        ServiceCategory, Service, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData,
        TechnicianLevelConfig, LoyaltyTransaction, ServicePricingField, ServicePricingRule, ServicePricingEvaluation,
        ServicePricingTierPricing,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      country.id, `مدينة قفل ${runId}`, `Lock City ${runId}`, `lock-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة قفل ${runId}`, `Lock Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة قفل ${runId}`, `Lock Cat ${runId}`, `lock-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'formula',$4,20,0,120) RETURNING id`,
      [ids.category, `خدمة قفل ${runId}`, `lock-svc-${runId}`, AHMED_PRICE_CENTS],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2081${runId}`.slice(0, 15), `عميل قفل ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع قفل ${runId}`],
    );
    ids.address = address.id;

    const makeTechnician = async (label: string, suffix: string, code: string) => {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+208${suffix}${runId}`.slice(0, 15), `${label} ${runId}`,
      ]);
      const [tech] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, verification_status, current_level, current_location)
         VALUES ($1,$2,'x','approved','professional', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `${code}${runId}`.slice(0, 20)],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`, [
        tech.id, ids.service,
      ]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [tech.id, ids.zone]);
      return { userId: user.id as string, techId: tech.id as string };
    };
    const ahmed = await makeTechnician('أحمد', '2', 'LKA');
    ids.ahmedUser = ahmed.userId;
    ids.ahmedTech = ahmed.techId;
    const mohamed = await makeTechnician('محمد', '3', 'LKM');
    ids.mohamedUser = mohamed.userId;
    ids.mohamedTech = mohamed.techId;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const auditStub = { record: async () => undefined } as unknown as AuditLogService;
    const settingsService = new SettingsService(dataSource.getRepository(Setting), auditStub, cache);
    const geoService = new GeoService(
      dataSource.getRepository(City), dataSource.getRepository(Area), dataSource.getRepository(ServiceZone), dataSource,
    );
    const addressesService = new AddressesService(
      dataSource.getRepository(Address), dataSource.getRepository(CustomerProfile), dataSource.getRepository(Order), geoService,
    );
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory), dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing), dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon), dataSource.getRepository(ServiceStandardData),
      settingsService, realPricingEngineService(dataSource), dataSource.getRepository(ServicePricingTierPricing),
    );
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile), dataSource.getRepository(TechnicianCompany), {} as never, {} as never,
      dataSource.getRepository(User), {} as never, {} as never, auditStub, geoService, settingsService,
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const walletsService = new WalletsService(
      dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource,
    );
    const technicianLevelsService = new TechnicianLevelsService(dataSource.getRepository(TechnicianLevelConfig), auditStub);
    const loyaltyService = new LoyaltyService(
      dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource,
    );
    const scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    const events = new EventEmitter2();
    const assignmentGuard = new TechnicianAssignmentGuardService(settingsService);
    const paymentsService = new PaymentsService(
      dataSource.getRepository(Order), dataSource.getRepository(Payment), dataSource.getRepository(Refund),
      dataSource.getRepository(User), dataSource.getRepository(WebhookEvent), dataSource, walletsService, catalogService,
      customerProfilesService, techniciansService, technicianLevelsService,
      { enqueueRecalculation: async () => undefined } as never, loyaltyService, settingsService, auditStub, events,
      {} as never, {} as never, {} as never, crewEarningsServiceStub(),
    );
    const supportService = new SupportService(
      dataSource.getRepository(Complaint), dataSource.getRepository(ComplaintMessage),
      dataSource.getRepository(ComplaintAttachment), dataSource.getRepository(Order), dataSource,
      customerProfilesService, techniciansService, walletsService, auditStub, events, {} as never,
    );

    ordersService = new OrdersService(
      dataSource.getRepository(Order), {} as never, {} as never, dataSource, auditStub, customerProfilesService,
      addressesService, catalogService, geoService, techniciansService, {} as never, scheduleService,
      realPricingEngineService(dataSource), {} as never, {} as never, {} as never, walletsService, settingsService,
      paymentsService, supportService, events, {} as never, commissionBaseServiceStub(),
      undefined, // crewShortageEscalation — مش موضوع الاختبار ده
      assignmentGuard,
    );

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment), dataSource.getRepository(Order), dataSource, {} as never,
      assignmentGuard, settingsService, { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource), levelPremiumServiceStub(),
      // ADR-0068 §3 — فك القفل بيرجّع فلوس، فلازم يسيب سطر audit. الـstub بيسجّل عشان الاختبار
      // تحت يثبت الكتابة فعلاً، مش يفترضها.
      { record: async (params: { action: string }) => { auditRecords.push(params); } } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const orderIds: { id: string }[] = await q(`SELECT id FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      const list = orderIds.map((o) => o.id);
      if (list.length) {
        await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [list]);
        await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [list]);
      }
      await q(`DELETE FROM booking_match_previews WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [[ids.ahmedTech, ids.mohamedTech]]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [[ids.ahmedTech, ids.mohamedTech]]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.ahmedTech, ids.mohamedTech]]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customerUser, ids.ahmedUser, ids.mohamedUser]]);
      await q(`DELETE FROM service_pricing_evaluations WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('خط الأساس: أحمد متاح ⇒ التأكيد بيمشي، الطلب مقفول عليه بسعره هو', async () => {
    const preview = await seedPreview(ids.ahmedTech);
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      scheduled_at: bookingDay(),
      match_preview_id: preview.id,
    } as never);

    expect(order.requestedTechnicianId).toBe(ids.ahmedTech);
    expect(order.selectedMatchPreviewId).toBe(preview.id);
    expect(order.totalAmountCents).toBe(AHMED_PRICE_CENTS);
    expect(order.bookingContextHash).not.toBeNull();
    const [reloaded] = await q(`SELECT status FROM booking_match_previews WHERE id = $1`, [preview.id]);
    expect(reloaded.status).toBe('consumed');
    await q(`DELETE FROM order_status_history WHERE order_id = $1`, [order.id]);
    await q(`DELETE FROM orders WHERE id = $1`, [order.id]);
  });

  it('بلاغ المالك بالحرف: أحمد بقى غير متاح ⇒ التأكيد بيترفض، مفيش طلب، مفيش محمد، والسعر ما اتغيّرش', async () => {
    const preview = await seedPreview(ids.ahmedTech);
    ids.blockerOrder = await makeAhmedBusy();

    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.service,
        address_id: ids.address,
        scheduled_at: bookingDay(),
        match_preview_id: preview.id,
      } as never),
    ).rejects.toMatchObject({ code: 'ORDR_001' });

    // مفيش أي طلب جديد غير الشغلانة اللي شغّلت أحمد أصلاً.
    const created = await q(`SELECT id, technician_id, requested_technician_id FROM orders WHERE customer_id = $1`, [
      ids.customerProfile,
    ]);
    expect(created).toHaveLength(1);
    expect(created[0].id).toBe(ids.blockerOrder);
    // محمد ماخدش حاجة — لا كطلب ولا كتفضيل.
    expect(created.some((o: { technician_id: string | null; requested_technician_id: string | null }) =>
      o.technician_id === ids.mohamedTech || o.requested_technician_id === ids.mohamedTech)).toBe(false);
    // التذكرة ماتت — مايصحّش يعيد نفس التأكيد بيها تاني.
    const [previewRow] = await q(`SELECT status, final_price_cents FROM booking_match_previews WHERE id = $1`, [preview.id]);
    expect(previewRow.status).toBe('stale');
    expect(previewRow.final_price_cents).toBe(AHMED_PRICE_CENTS);
  });

  it('التوزيع: طلب مقفول على أحمد وأحمد بقى مش متاح ⇒ الطلب بيروح لاختيار العميل، مش لمحمد', async () => {
    auditRecords.length = 0;
    // طلب مقفول على أحمد اتعمل وأحمد لسه متاح (الشغلانة الشاغلة اتشالت مؤقتًا).
    await q(`UPDATE orders SET order_status = 'cancelled_by_system' WHERE id = $1`, [ids.blockerOrder]);
    const preview = await seedPreview(ids.ahmedTech);
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      scheduled_at: bookingDay(),
      match_preview_id: preview.id,
    } as never);
    expect(order.requestedTechnicianId).toBe(ids.ahmedTech);

    // وبعدين أحمد بقى مشغول فعلاً قبل ما التوزيع يشتغل.
    await q(`UPDATE orders SET order_status = 'accepted' WHERE id = $1`, [ids.blockerOrder]);

    const result = await matchingService.dispatchNextRound(order.id);
    expect(result.dispatched).toBe(0);

    const [after] = await q(
      `SELECT order_status, requested_technician_id, technician_id, total_amount_cents, selected_match_preview_id
         FROM orders WHERE id = $1`,
      [order.id],
    );
    expect(after.order_status).toBe(OrderStatus.AWAITING_TECHNICIAN_RESELECTION);
    // القفل انفك، بس التذكرة اللي أنشأت الطلب فضلت مسجّلة (سجل تاريخي).
    expect(after.requested_technician_id).toBeNull();
    expect(after.selected_match_preview_id).toBe(preview.id);
    // ولا فني اتعيّن، ومحدش اتعرض عليه — لا محمد ولا غيره.
    expect(after.technician_id).toBeNull();
    expect(after.total_amount_cents).toBe(AHMED_PRICE_CENTS);
    const assignments = await q(`SELECT technician_id FROM order_assignments WHERE order_id = $1`, [order.id]);
    expect(assignments).toHaveLength(0);

    // ADR-0068 §3 — فك القفل بيرجّع فرق المستوى من إجمالي الطلب، وده تحرّك فلوس. قبل الشغل ده
    // كان بيتسجّل في order_status_history بس، من غير أي سطر audit بيقول ليه ولا كام اترجّع.
    const release = auditRecords.find((r) => r.action === 'order.provider_lock.released');
    expect(release).toBeDefined();
    expect(release?.actorRole).toBe('system');
    expect(release?.newValues).toMatchObject({ requested_technician_id: null, reason: 'technician_unavailable' });
    expect(release?.oldValues).toMatchObject({ requested_technician_id: ids.ahmedTech });
  });

  it('إعادة الاختيار: طلب سعره مربوط بمنفّذ مايرجعش للتوزيع بلا تذكرة جديدة', async () => {
    const [bound] = await q(
      `SELECT id FROM orders WHERE customer_id = $1 AND order_status = 'awaiting_technician_reselection' LIMIT 1`,
      [ids.customerProfile],
    );
    expect(bound).toBeDefined();
    await expect(ordersService.requestRematch(ids.customerUser, bound.id, {} as never)).rejects.toMatchObject({
      code: 'VAL_001',
    });
    await expect(
      ordersService.requestRematch(ids.customerUser, bound.id, { requested_technician_id: ids.mohamedTech } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('إعادة الاختيار بتذكرة محمد: الطلب بيرجع للتوزيع بسعر محمد، والتذكرة بتتستهلك', async () => {
    const [bound] = await q(
      `SELECT id FROM orders WHERE customer_id = $1 AND order_status = 'awaiting_technician_reselection' LIMIT 1`,
      [ids.customerProfile],
    );
    const replacement = await seedPreview(ids.mohamedTech);
    // سعر محمد مختلف عمدًا — الطلب لازم ياخد السعر الجديد، مش يفضل على سعر أحمد.
    const MOHAMED_PRICE_CENTS = 41_000;
    await q(`UPDATE booking_match_previews SET final_price_cents = $1, pricing_snapshot = $2 WHERE id = $3`, [
      MOHAMED_PRICE_CENTS,
      JSON.stringify({
        base_price_cents: MOHAMED_PRICE_CENTS,
        inspection_fee_cents: 0,
        emergency_surcharge_cents: 0,
        discount_cents: 0,
        warranty_price_cents: 0,
        duration_minutes: null,
        estimated_duration_days: null,
        required_technicians: null,
        required_assistants: null,
      }),
      replacement.id,
    ]);

    const updated = await ordersService.requestRematch(ids.customerUser, bound.id, {
      match_preview_id: replacement.id,
    } as never);
    expect(updated.orderStatus).toBe(OrderStatus.SEARCHING_TECHNICIAN);

    const [after] = await q(
      `SELECT requested_technician_id, total_amount_cents, selected_match_preview_id FROM orders WHERE id = $1`,
      [bound.id],
    );
    expect(after.requested_technician_id).toBe(ids.mohamedTech);
    expect(after.total_amount_cents).toBe(MOHAMED_PRICE_CENTS);
    expect(after.selected_match_preview_id).toBe(replacement.id);
    const [previewRow] = await q(`SELECT status FROM booking_match_previews WHERE id = $1`, [replacement.id]);
    expect(previewRow.status).toBe('consumed');
  });
});
