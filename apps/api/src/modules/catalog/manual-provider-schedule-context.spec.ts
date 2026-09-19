import { DataSource } from 'typeorm';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Service } from './entities/service.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PricingFieldsService } from '../pricing/pricing-fields.service';
import { PricingRulesService } from '../pricing/pricing-rules.service';
import { PricingTemplatesService } from '../pricing/pricing-templates.service';
import { PricingTemplateKey } from '../pricing/pricing-templates';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { Order } from '../orders/entities/order.entity';
import { technicianAvailabilityCondition } from '../technicians/technician-eligibility.sql';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { DAILY_CAPACITY_MINUTES_FALLBACK } from '../technicians/technician-day-capacity.sql';

/**
 * **الموعد الناقص مش «دلوقتي»** (بلاغ مالك 2026-09-19).
 *
 * في `customer-web` العميل يقدر يحوّل لـ«اختار المنفّذ بنفسك» قبل ما يختار تاريخ، والصفحة كانت
 * بتنادي `GET /services/:id/technicians` على طول. `scheduled_at` بيروح فاضي، ومحرك الأهلية
 * بيقراه بـ`COALESCE(scheduled_at, now())` — يعني **اللحظة دي**. النتيجة: فني مؤهّل تمامًا
 * للموعد اللي العميل ناوي عليه بيختفي لمجرد إنه مشغول/حاجز النهارده، والشاشة بتقول «مفيش
 * فنيين متاحين في منطقتك دلوقتي للخدمة دي» قبل ما يتحدد أي ميعاد أصلاً.
 *
 * السويت دي بتقفل الفئة دي من الباك-إند — مستقلة تمامًا عن أي واجهة (بوابة الويب نفسها
 * متغطية في `apps/customer-web/test/provider-discovery.test.mjs`).
 */
describe('GET /services/:id/technicians — سياق الجدولة هو اللي بيحدد الأهلية، والناقص بيترفض', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let controller: CatalogController;
  let techniciansService: TechniciansService;
  const runId = Date.now().toString(36);
  const ids = {
    categoryId: '',
    cityId: '',
    zoneId: '',
    serviceId: '',
    asapServiceId: '',
    customerUserId: '',
    customerProfileId: '',
    addressId: '',
    freeUserId: '',
    freeTechId: '',
    blockedTodayUserId: '',
    blockedTodayTechId: '',
    busyAtSlotUserId: '',
    busyAtSlotTechId: '',
    busyOrderId: '',
  };

  /** مدة الخدمة بالدقايق — نافذة الحجز المرشّح بتتبني منها (ساعتين). */
  const SERVICE_MINUTES = 120;
  /** قالب «بالساعة» بيدّي المدة الحقيقية للحجز المرشّح، وبيها التعارض بيبقى تقاطع وقت فعلي
   *  (ADR-0077) مش مجرد سقف يومي — من غيرها الساعة مش بتفرق أصلاً. */
  const BOOKED_HOURS = SERVICE_MINUTES / 60;
  const HOURLY_RATE_CENTS = 30_000;
  /** الموعد اللي العميل ناوي عليه: بعد شهر، ٠٧:٠٠ UTC — بعيد خالص عن «دلوقتي». */
  const bookingAt = new Date(Date.now() + 30 * 86_400_000);
  bookingAt.setUTCHours(7, 0, 0, 0);
  /** نفس اليوم، بس بعد نافذة الشغل المحجوز بساعتين — ساعة فاضية في يوم مشغول. */
  const freeSlotSameDay = new Date(bookingAt.getTime() + 4 * 3_600_000);

  const listAt = async (serviceId: string, scheduledAt: Date | null, extra: Record<string, unknown> = {}) =>
    controller.listTechniciansForService(serviceId, {
      address_id: ids.addressId,
      field_values: { hours: BOOKED_HOURS },
      ...(scheduledAt ? { scheduled_at: scheduledAt.toISOString() } : {}),
      ...extra,
    } as never);

  /**
   * **«ظاهر» في الرد مش معناها «متاح»** — ADR-0030 بيرجّع كمان دلو تاني
   * (`availability_status = 'schedule_conflicted'`) للمؤهّل المتعارض جدوليًا، عشان العميل
   * يعرف إنه موجود بس مش في الميعاد ده. كل الحُكم هنا على الدلو المتاح فعلاً.
   */
  const availableAt = async (serviceId: string, scheduledAt: Date | null, extra: Record<string, unknown> = {}) =>
    (await listAt(serviceId, scheduledAt, extra))
      .filter((t) => t.availability_status === 'available')
      .map((t) => t.id);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData,
        ServicePricingTierPricing, ServicePricingField, ServicePricingRule, ServicePricingEvaluation,
        City, Area, ServiceZone, User, TechnicianProfile, Order,
      ],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries LIMIT 1`);
    const [category] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة سياق الجدولة ${runId}`,
      `SchedCtxCat ${runId}`,
      `sched-ctx-cat-${runId}`,
    ]);
    ids.categoryId = category.id;
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة سياق الجدولة ${runId}`, `SchedCtxCity${runId}`, `sched-ctx-city-${runId}`],
    );
    ids.cityId = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق سياق الجدولة ${runId}`, `SchedCtxZone${runId}`],
    );
    ids.zoneId = zone.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2081${runId}`.slice(0, 15), `عميل سياق الجدولة ${runId}`],
    );
    ids.customerUserId = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUserId,
    ]);
    ids.customerProfileId = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUserId, ids.cityId, 'شارع سياق الجدولة'],
    );
    ids.addressId = address.id;

    // خدمة مجدولة بدقة ساعة — دي الحالة اللي الساعة فيها جزء من الحجز مش تفصيلة عرض.
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,estimated_duration_minutes,
                             is_active,allows_scheduling,allows_emergency,requires_start_time_only)
       VALUES ($1,$2,$3,'formula',1,$4,true,true,true,true) RETURNING id`,
      [ids.categoryId, `خدمة مجدولة بالساعة ${runId}`, `sched-ctx-svc-${runId}`, SERVICE_MINUTES],
    );
    ids.serviceId = svc.id;
    // خدمة ASAP حقيقية — `allows_scheduling = false` يعني مفيش ميعاد أصلاً، فغيابه مش نقص.
    const [asapSvc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,estimated_duration_minutes,
                             is_active,allows_scheduling,allows_emergency)
       VALUES ($1,$2,$3,'formula',1,$4,true,false,true) RETURNING id`,
      [ids.categoryId, `خدمة فورية ${runId}`, `sched-ctx-asap-${runId}`, SERVICE_MINUTES],
    );
    ids.asapServiceId = asapSvc.id;

    const auditStub = { record: async () => undefined } as never;
    const fieldsService = new PricingFieldsService(
      dataSource.getRepository(ServicePricingField),
      dataSource.getRepository(ServicePricingRule),
      auditStub,
    );
    const rulesService = new PricingRulesService(
      dataSource.getRepository(ServicePricingRule),
      dataSource.getRepository(ServicePricingField),
      auditStub,
    );
    const templatesService = new PricingTemplatesService(
      dataSource.getRepository(Service),
      dataSource.getRepository(ServicePricingField),
      fieldsService,
      rulesService,
      auditStub,
    );
    for (const serviceId of [ids.serviceId, ids.asapServiceId]) {
      await templatesService.apply('sched-ctx-spec', serviceId, PricingTemplateKey.HOURLY, HOURLY_RATE_CENTS);
    }

    const makeTechnician = async (label: string, phoneSuffix: string, codePrefix: string) => {
      const [user] = await q(
        `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
        [`+208${phoneSuffix}${runId}`.slice(0, 15), `${label} ${runId}`],
      );
      const [tech] = await q(
        `INSERT INTO technician_profiles (user_id,technician_code,national_id_encrypted,verification_status,current_level,current_location)
         VALUES ($1,$2,'x','approved','new', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
        [user.id, `${codePrefix}${runId}`.slice(0, 20)],
      );
      for (const serviceId of [ids.serviceId, ids.asapServiceId]) {
        await q(
          `INSERT INTO technician_services (technician_id,service_id,is_active,verification_status) VALUES ($1,$2,true,'approved')`,
          [tech.id, serviceId],
        );
      }
      await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [
        tech.id,
        ids.zoneId,
      ]);
      return { userId: user.id as string, techId: tech.id as string };
    };

    const free = await makeTechnician('فني فاضي', '2', 'SCF');
    ids.freeUserId = free.userId;
    ids.freeTechId = free.techId;
    const blockedToday = await makeTechnician('فني حاجز النهارده', '3', 'SCB');
    ids.blockedTodayUserId = blockedToday.userId;
    ids.blockedTodayTechId = blockedToday.techId;
    const busyAtSlot = await makeTechnician('فني مشغول في الموعد', '4', 'SCS');
    ids.busyAtSlotUserId = busyAtSlot.userId;
    ids.busyAtSlotTechId = busyAtSlot.techId;

    // **«مشغول دلوقتي، فاضي يوم الحجز»** — إجازة ذاتية النهارده بالكامل، وصفر التزام يوم الحجز.
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date, '00:00', '23:59', 'blocked')`,
      [ids.blockedTodayTechId],
    );

    // **«فاضي دلوقتي، مشغول في الموعد»** — شغل مقبول في نفس ساعة الحجز بالظبط.
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [busyOrder] = await q(
      `INSERT INTO orders (commission_rate_applied,order_number,customer_id,technician_id,service_id,address_id,order_type,
                            booking_mode,order_status,scheduled_at,duration_minutes,estimated_duration_days,
                            total_amount_cents,payment_status,placed_at,source_channel)
       VALUES (20,$1,$2,$3,$4,$5,'standard','individual','accepted',$6,$7,1,10000,'unpaid', now(), 'customer_app') RETURNING id`,
      [orderNumber, ids.customerProfileId, ids.busyAtSlotTechId, ids.serviceId, ids.addressId, bookingAt, SERVICE_MINUTES],
    );
    ids.busyOrderId = busyOrder.id;

    const settingsStub = { getNumber: async (_key: string, fallback: number) => fallback } as never;
    const engine = new PricingEngineService(
      dataSource.getRepository(ServicePricingEvaluation),
      fieldsService,
      rulesService,
      dataSource.getRepository(Service),
    );
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsStub,
      engine,
      dataSource.getRepository(ServicePricingTierPricing),
    );
    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
    techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      geoService,
      settingsStub,
    );
    controller = new CatalogController(
      catalogService,
      techniciansService,
      { getUrl: async (key: string) => key } as never,
      settingsStub,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const techIds = [ids.freeTechId, ids.blockedTodayTechId, ids.busyAtSlotTechId];
    const serviceIds = [ids.serviceId, ids.asapServiceId];
    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.busyOrderId]);
    await q(`DELETE FROM service_pricing_evaluations WHERE service_id = ANY($1::uuid[])`, [serviceIds]);
    await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM customer_profiles WHERE user_id = $1`, [ids.customerUserId]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [ids.freeUserId, ids.blockedTodayUserId, ids.busyAtSlotUserId, ids.customerUserId],
    ]);
    await q(`DELETE FROM service_pricing_rules WHERE service_id = ANY($1::uuid[])`, [serviceIds]);
    await q(`DELETE FROM service_pricing_fields WHERE service_id = ANY($1::uuid[])`, [serviceIds]);
    await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [serviceIds]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.categoryId]);
    await dataSource.destroy();
  });

  it('١: الوضع اليدوي قبل اختيار الموعد — الطلب بيترفض صراحة بدل ما يتقاس على «دلوقتي»', async () => {
    // الرفض هنا هو الإصلاح نفسه: قايمة مبنية على «النهارده» لحجز الشهر الجاي إجابة غلط
    // على سؤال ماتسألش، ورسالة واضحة أنفع للعميل من قايمة فاضية مضلّلة.
    await expect(listAt(ids.serviceId, null)).rejects.toThrow(/اختار الموعد الأول/);
  });

  it('١-ب: الطوارئ و«الخدمة الفورية» مابيتلمسوش — غياب الموعد فيهم مقصود', async () => {
    // نفس اليوم = طوارئ صريحة من العميل.
    expect(await availableAt(ids.serviceId, null, { booking_mode: 'emergency' })).toContain(ids.freeTechId);
    // خدمة `allows_scheduling = false` مالهاش ميعاد أصلاً.
    expect(await availableAt(ids.asapServiceId, null)).toContain(ids.freeTechId);
  });

  it('٣: بعد التاريخ والساعة — الفني المؤهّل الفاضي في الفترة دي بيظهر', async () => {
    expect(await availableAt(ids.serviceId, bookingAt)).toContain(ids.freeTechId);
  });

  it('٤: مشغول دلوقتي وفاضي في الموعد المستقبلي — بيظهر', async () => {
    expect(await availableAt(ids.serviceId, bookingAt)).toContain(ids.blockedTodayTechId);

    // والإثبات إن ده بالظبط اللي كان بيضيع: نفس الفني على سياق «دلوقتي» بيتقفل عليه.
    const asNow = await techniciansService.diagnoseBookingCandidatePool({
      serviceId: ids.serviceId,
      addressId: ids.addressId,
      scheduledAt: null,
      isTeamBooking: false,
    });
    const atBooking = await techniciansService.diagnoseBookingCandidatePool({
      serviceId: ids.serviceId,
      addressId: ids.addressId,
      scheduledAt: bookingAt,
      isTeamBooking: false,
    });
    const stage = (d: typeof asNow, name: string) => d.stages.find((s) => s.stage === name)?.remaining ?? -1;
    // على «دلوقتي» الإجازة الذاتية بتقص من الدلو؛ على الموعد الحقيقي مابتقصّش — نفس الفني،
    // نفس القواعد، سياق جدولة مختلف. وده بالظبط اللي كان بيختفي بصمت قبل الإصلاح.
    expect(stage(asNow, 'not_blocked')).toBeLessThan(stage(asNow, 'individually_visible'));
    expect(stage(atBooking, 'not_blocked')).toBe(stage(atBooking, 'individually_visible'));
  });

  it('٥: فاضي دلوقتي ومشغول في الموعد المستقبلي — مش بيظهر كمتاح', async () => {
    expect(await availableAt(ids.serviceId, bookingAt)).not.toContain(ids.busyAtSlotTechId);
  });

  it('٢: الساعة جزء من الأهلية مش تفصيلة عرض — نفس اليوم، ساعة تانية، نتيجة تانية', async () => {
    // ده سبب وجود بوابة «استنى الساعة» في الويب: لو اتبعت التاريخ لوحده (منتصف الليل)،
    // الإجابة بتبقى لموعد حقيقي مختلف تمامًا عن اللي العميل هيختاره.
    expect(await availableAt(ids.serviceId, bookingAt)).not.toContain(ids.busyAtSlotTechId);
    expect(await availableAt(ids.serviceId, freeSlotSameDay)).toContain(ids.busyAtSlotTechId);
  });

  it('٦: تغيير الموعد بيعيد حساب الأهلية من جديد — مفيش نتيجة قديمة بتفضل سارية', async () => {
    const first = (await availableAt(ids.serviceId, bookingAt)).sort();
    const second = (await availableAt(ids.serviceId, freeSlotSameDay)).sort();
    expect(second).not.toEqual(first);
    expect(first).toContain(ids.freeTechId);
    expect(second).toContain(ids.freeTechId);
  });

  it('٧: نفس سياق الجدولة ⇒ القايمة اليدوية والمطابقة الحقيقية مابيختلفوش', async () => {
    // المطابقة الفعلية بتقرا `orders.scheduled_at`، والقايمة اليدوية بتقرا `query.scheduled_at`.
    // الاختبار بيشغّل **نفس** `technicianAvailabilityCondition()` من مصدر الطلب المحفوظ
    // ويقارن الحكم بالقايمة — أي انحراف هنا معناه إن الواجهتين بيوعدوا بحاجة والتأكيد بيرفضها.
    const listed = (await availableAt(ids.serviceId, bookingAt)).sort();
    const rows = await dataSource.query<{ id: string }[]>(
      `SELECT tp.id
         FROM technician_profiles tp
         JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
         JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1
              AND ts.is_active = true AND ts.verification_status = 'approved'
        WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL AND tp.current_location IS NOT NULL
          ${technicianAvailabilityCondition({
            technicianIdExpr: 'tp.id',
            // الميعاد جاي من صف الطلب نفسه، مش من مدخلات الاختبار — ده بيت القصيد.
            scheduledAtParam: '(SELECT o.scheduled_at FROM orders o WHERE o.id = $3::uuid)',
            excludeOrderIdParam: 'NULL',
            activeStatusesParam: '$4',
            engagedStatusesParam: '$5',
            isEmergencyParam: '$6',
            serviceDurationExpr: '$8::int',
            preciseDurationHoursExpr: '$8::numeric / 60.0',
            candidateLoad: {
              estimatedDurationDaysExpr: 'NULL',
              durationMinutesExpr: '$8::int',
              serviceDefaultMinutesExpr: 'NULL',
            },
            dailyCapacityMinutesParam: '$7',
          })}`,
      [
        ids.serviceId,
        ids.zoneId,
        ids.busyOrderId,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        DAILY_CAPACITY_MINUTES_FALLBACK,
        SERVICE_MINUTES,
      ],
    );
    // نفس الحكم بالظبط: اللي المطابقة بتعتبره متاح على ميعاد الطلب المحفوظ هو نفسه اللي
    // القايمة اليدوية عرضته كمتاح — مفيش وعد بيتكسر عند التأكيد بسبب فرق سياق.
    expect(rows.map((r) => r.id).sort()).toEqual(listed);
  });
});
