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
import { PricingFieldsService } from '../pricing/pricing-fields.service';
import { PricingRulesService } from '../pricing/pricing-rules.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
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

/**
 * **الإثبات من الزرار للنتيجة** (ADR-0064 §3، docs/08 §116-B) — الاختبار اللي فوقه في
 * `technicians/multi-day-booking-availability.spec.ts` بيثبت إن الخدمة بتفلتر صح **لو** اتبعتلها
 * الحمل. الاختبار ده بيثبت إن `GET /services/:id/technicians` — المسار اللي تطبيق العميل
 * و`customer-web` بينادوه فعلاً — **بيحسب الحمل ويبعته**.
 *
 * من غير الطبقة دي، الإصلاح بيبقى موجود في الكود وغير واصل لأي مستخدم حقيقي.
 */
describe('GET /services/:id/technicians — الحجز الممتد بيخفي الفني المشغول في نص مداه (ADR-0064 §3)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let controller: CatalogController;
  const runId = Date.now().toString(36);
  const ids = {
    categoryId: '',
    cityId: '',
    zoneId: '',
    serviceId: '',
    customerUserId: '',
    customerProfileId: '',
    addressId: '',
    freeUserId: '',
    freeTechId: '',
    busyUserId: '',
    busyTechId: '',
    busyOrderId: '',
  };

  const bookingStart = new Date('2027-11-01T09:00:00Z');
  const midSpanBusyDay = new Date('2027-11-20T09:00:00Z');
  const CONTRACT_DAYS = 67;
  const DAILY_RATE_CENTS = 20_000;

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
      `فئة نقطة النهاية ${runId}`,
      `EndpointCat ${runId}`,
      `endpoint-cat-${runId}`,
    ]);
    ids.categoryId = category.id;
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة نقطة النهاية ${runId}`, `EndpointCity${runId}`, `endpoint-city-${runId}`],
    );
    ids.cityId = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق نقطة النهاية ${runId}`, `EndpointZone${runId}`],
    );
    ids.zoneId = zone.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2071${runId}`.slice(0, 15), `عميل نقطة النهاية ${runId}`],
    );
    ids.customerUserId = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUserId]);
    ids.customerProfileId = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUserId, ids.cityId, 'شارع اختبار نقطة النهاية'],
    );
    ids.addressId = address.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,estimated_duration_minutes,is_active)
       VALUES ($1,$2,$3,'formula',1,60,true) RETURNING id`,
      [ids.categoryId, `خدمة تعاقد باليوم ${runId}`, `endpoint-daily-${runId}`],
    );
    ids.serviceId = svc.id;

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
    const engine = new PricingEngineService(
      dataSource.getRepository(ServicePricingEvaluation),
      fieldsService,
      rulesService,
      dataSource.getRepository(Service),
    );
    const templatesService = new PricingTemplatesService(
      dataSource.getRepository(Service),
      dataSource.getRepository(ServicePricingField),
      fieldsService,
      rulesService,
      auditStub,
    );
    // قالب «باليوم» بيولّد حقل `days` ومخرج `estimated_duration_days` — نفس القالب اللي الأدمن
    // بيستخدمه للتعاقدات الشهرية بالظبط (ADR-0061 §1).
    await templatesService.apply('admin-endpoint-spec', ids.serviceId, PricingTemplateKey.DAILY, DAILY_RATE_CENTS);

    const makeTechnician = async (label: string, phoneSuffix: string, codePrefix: string) => {
      const [user] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+207${phoneSuffix}${runId}`.slice(0, 15),
        `${label} ${runId}`,
      ]);
      const [tech] = await q(
        `INSERT INTO technician_profiles (user_id,technician_code,national_id_encrypted,verification_status,current_level,current_location)
         VALUES ($1,$2,'x','approved','new', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
        [user.id, `${codePrefix}${runId}`.slice(0, 20)],
      );
      await q(
        `INSERT INTO technician_services (technician_id,service_id,is_active,verification_status) VALUES ($1,$2,true,'approved')`,
        [tech.id, ids.serviceId],
      );
      await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [tech.id, ids.zoneId]);
      return { userId: user.id as string, techId: tech.id as string };
    };
    const free = await makeTechnician('فني فاضي نقطة النهاية', '2', 'EPF');
    ids.freeUserId = free.userId;
    ids.freeTechId = free.techId;
    const busy = await makeTechnician('فني مشغول في النص', '3', 'EPB');
    ids.busyUserId = busy.userId;
    ids.busyTechId = busy.techId;

    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [busyOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, order_type, booking_mode,
                            order_status, scheduled_at, estimated_duration_days, total_amount_cents, payment_status, placed_at, source_channel)
       VALUES ($1,$2,$3,$4,$5,'standard','individual','accepted',$6,1,10000,'unpaid', now(), 'customer_app') RETURNING id`,
      [orderNumber, ids.customerProfileId, ids.busyTechId, ids.serviceId, ids.addressId, midSpanBusyDay],
    );
    ids.busyOrderId = busyOrder.id;

    const settingsStub = { getNumber: async (_key: string, fallback: number) => fallback } as never;
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
    const techniciansService = new TechniciansService(
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
    controller = new CatalogController(catalogService, techniciansService, { getUrl: async (key: string) => key } as never);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const techIds = [ids.freeTechId, ids.busyTechId];
    await q(`DELETE FROM orders WHERE id = $1`, [ids.busyOrderId]);
    await q(`DELETE FROM service_pricing_evaluations WHERE service_id = $1`, [ids.serviceId]);
    await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM customer_profiles WHERE user_id = $1`, [ids.customerUserId]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.freeUserId, ids.busyUserId, ids.customerUserId]]);
    await q(`DELETE FROM service_pricing_rules WHERE service_id = $1`, [ids.serviceId]);
    await q(`DELETE FROM service_pricing_fields WHERE service_id = $1`, [ids.serviceId]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.serviceId]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.categoryId]);
    await dataSource.destroy();
  });

  it('العميل طالب 67 يوم: الفني المشغول في اليوم 20 مش بيرجع في رد الـendpoint', async () => {
    const response = await controller.listTechniciansForService(ids.serviceId, {
      address_id: ids.addressId,
      scheduled_at: bookingStart.toISOString(),
      field_values: { days: CONTRACT_DAYS },
    } as never);
    const returnedIds = response.map((item) => item.id);
    expect(returnedIds).toContain(ids.freeTechId);
    expect(returnedIds).not.toContain(ids.busyTechId);
  });

  it('نفس الخدمة بحجز يوم واحد: الفني المشغول في اليوم 20 بيرجع عادي (الفلترة بالمدى مش بالفني)', async () => {
    const response = await controller.listTechniciansForService(ids.serviceId, {
      address_id: ids.addressId,
      scheduled_at: bookingStart.toISOString(),
      field_values: { days: 1 },
    } as never);
    const returnedIds = response.map((item) => item.id);
    expect(returnedIds).toContain(ids.freeTechId);
    expect(returnedIds).toContain(ids.busyTechId);
  });

  it('السعر المعروض جاي من نفس التقييم اللي حدد الحمل — 67 يوم × السعر اليومي', async () => {
    const response = await controller.listTechniciansForService(ids.serviceId, {
      address_id: ids.addressId,
      scheduled_at: bookingStart.toISOString(),
      field_values: { days: CONTRACT_DAYS },
    } as never);
    const free = response.find((item) => item.id === ids.freeTechId);
    expect(free?.final_price_cents).toBe(CONTRACT_DAYS * DAILY_RATE_CENTS);
  });
});
