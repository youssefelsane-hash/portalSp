import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';
import { Service } from '../catalog/entities/service.entity';
import { Order } from '../orders/entities/order.entity';

/**
 * **بلاغ المالك 2026-09-02 (docs/08 §116-B، ADR-0064 §3)** بالحرف:
 *
 * > «طلب شهري بيمتد 67 يوم. الفني اللي اتعرض كان عنده شغل في النص، ومع ذلك السيستم خلاه يظهر
 * > إنه متاح. المفروض الوقت بالدقايق كلها الراجل ده شغالها كلها تكون مقفولة.»
 *
 * السبب الجذري: `TechniciansService` كانت بتنادي محرك التوافر المشترك **من غير**
 * `candidateLoad`، فبتقع على الافتراضي (`estimated_duration_days = NULL` ⇒ يوم واحد). يعني كل
 * حجز — 67 يوم أو 8 ساعات — كان بيتفحص على **يوم بدايته بس**.
 *
 * الاختبار ده بيثبت الاتنين مع بعض على داتابيز حقيقية:
 * - السلوك **المكسور** (بلا حمل) — الفني المشغول في نص المدى بيفضل ظاهر. ده مش اختبار للسلوك
 *   القديم عشان نحافظ عليه، ده **إثبات إن الحمل هو فعلاً اللي بيفرق**، مش أي شرط تاني اتغيّر.
 * - السلوك **المصلَّح** (بالحمل) — بيختفي.
 */
describe('TechniciansService — الحجز متعدد الأيام بيقفل كل أيامه، مش يوم بدايته (ADR-0064 §3)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let service: TechniciansService;
  const runId = Date.now().toString(36);
  const ids = {
    countryId: '',
    cityId: '',
    zoneId: '',
    customerUserId: '',
    customerProfileId: '',
    addressId: '',
    categoryId: '',
    serviceId: '',
    serviceShowConflictedId: '',
    freeUserId: '',
    freeTechId: '',
    midBusyUserId: '',
    midBusyTechId: '',
    hoursBusyUserId: '',
    hoursBusyTechId: '',
    midBusyOrderId: '',
    hoursBusyOrderId: '',
  };

  // بداية الحجز المرشّح، ويوم مشغول في **نص** الـ67 يوم (اليوم 30) — بعيد خالص عن يوم البداية
  // عشان أي نجاح مايجيش بالصدفة من قاعدة «نفس اليوم».
  const bookingStart = new Date('2027-10-01T09:00:00Z');
  const midSpanBusyDay = new Date('2027-10-31T09:00:00Z');
  const CONTRACT_DAYS = 67;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, City, Area, ServiceZone, Service, Order],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries LIMIT 1`);
    ids.countryId = country.id;
    const [category] = await q(`SELECT id FROM service_categories LIMIT 1`);
    ids.categoryId = category.id;

    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.countryId, `مدينة مدى ${runId}`, `SpanCity${runId}`, `span-city-${runId}`],
    );
    ids.cityId = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق مدى ${runId}`, `SpanZone${runId}`],
    );
    ids.zoneId = zone.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2061${runId}`.slice(0, 15), `عميل مدى ${runId}`],
    );
    ids.customerUserId = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUserId]);
    ids.customerProfileId = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUserId, ids.cityId, 'شارع اختبار الحجز الممتد'],
    );
    ids.addressId = address.id;

    // `estimated_duration_minutes = 60` — الافتراضي اللي الفلترة المكسورة كانت بتقع عليه.
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,estimated_duration_minutes,is_active)
       VALUES ($1,$2,$3,'formula',10000,60,true) RETURNING id`,
      [ids.categoryId, `خدمة تعاقد ممتد ${runId}`, `span-service-${runId}`],
    );
    ids.serviceId = svc.id;
    const [svcShown] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,estimated_duration_minutes,is_active,show_unavailable_providers)
       VALUES ($1,$2,$3,'formula',10000,60,true,true) RETURNING id`,
      [ids.categoryId, `خدمة تعاقد ممتد بإظهار ${runId}`, `span-service-shown-${runId}`],
    );
    ids.serviceShowConflictedId = svcShown.id;

    const makeTechnician = async (label: string, phoneSuffix: string, codePrefix: string) => {
      const [user] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+206${phoneSuffix}${runId}`.slice(0, 15),
        `${label} ${runId}`,
      ]);
      const [tech] = await q(
        `INSERT INTO technician_profiles (user_id,technician_code,national_id_encrypted,verification_status,current_level,current_location)
         VALUES ($1,$2,'x','approved','new', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
        [user.id, `${codePrefix}${runId}`.slice(0, 20)],
      );
      for (const serviceId of [ids.serviceId, ids.serviceShowConflictedId]) {
        await q(
          `INSERT INTO technician_services (technician_id,service_id,is_active,verification_status) VALUES ($1,$2,true,'approved')`,
          [tech.id, serviceId],
        );
      }
      await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [tech.id, ids.zoneId]);
      return { userId: user.id as string, techId: tech.id as string };
    };

    const free = await makeTechnician('فني فاضي طول المدة', '2', 'SPF');
    ids.freeUserId = free.userId;
    ids.freeTechId = free.techId;
    const midBusy = await makeTechnician('فني مشغول في نص المدة', '3', 'SPM');
    ids.midBusyUserId = midBusy.userId;
    ids.midBusyTechId = midBusy.techId;
    const hoursBusy = await makeTechnician('فني عنده ساعات في نص المدة', '4', 'SPH');
    ids.hoursBusyUserId = hoursBusy.userId;
    ids.hoursBusyTechId = hoursBusy.techId;

    const insertOrder = async (technicianId: string, scheduledAt: Date, load: { days?: number; minutes?: number }) => {
      const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
      const [row] = await q(
        `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, order_type, booking_mode,
                              order_status, scheduled_at, estimated_duration_days, duration_minutes,
                              total_amount_cents, payment_status, placed_at, source_channel)
         VALUES ($1,$2,$3,$4,$5,'standard','individual','accepted',$6,$7,$8,10000,'unpaid', now(), 'customer_app') RETURNING id`,
        [orderNumber, ids.customerProfileId, technicianId, ids.serviceId, ids.addressId, scheduledAt, load.days ?? null, load.minutes ?? null],
      );
      return row.id as string;
    };

    // شغل يوم كامل في **اليوم 30** من مدى الحجز المرشّح — بالظبط «عنده شغل في النص».
    ids.midBusyOrderId = await insertOrder(ids.midBusyTechId, midSpanBusyDay, { days: 1 });
    // شغل بالساعات (10 ساعات) في نفس اليوم — بيختبر مسار الدقايق مش الأيام.
    ids.hoursBusyOrderId = await insertOrder(ids.hoursBusyTechId, midSpanBusyDay, { minutes: 600 });

    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
    const settingsServiceStub = { getNumber: async (_key: string, defaultValue: number) => defaultValue };
    service = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      geoService,
      settingsServiceStub as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const techIds = [ids.freeTechId, ids.midBusyTechId, ids.hoursBusyTechId];
    const userIds = [ids.freeUserId, ids.midBusyUserId, ids.hoursBusyUserId];
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [[ids.midBusyOrderId, ids.hoursBusyOrderId]]);
    await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM customer_profiles WHERE user_id = $1`, [ids.customerUserId]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[...userIds, ids.customerUserId]]);
    await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.serviceId, ids.serviceShowConflictedId]]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('البَقّة المبلّغة: من غير حمل تشغيلي، الفني المشغول في نص الـ67 يوم بيفضل ظاهر «متاح»', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, bookingStart);
    const technicianIds = items.map((i) => i.technicianId);
    expect(technicianIds).toContain(ids.freeTechId);
    // ده السلوك اللي المالك شافه: يوم البداية فاضي، فالفني «متاح» رغم إنه محجوز في اليوم 30.
    expect(technicianIds).toContain(ids.midBusyTechId);
    expect(technicianIds).toContain(ids.hoursBusyTechId);
  });

  it('الإصلاح: بحمل 67 يوم، الفني المشغول في نص المدى بيختفي والفاضي بس اللي بيفضل', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, bookingStart, false, true, {
      durationMinutes: null,
      estimatedDurationDays: CONTRACT_DAYS,
    });
    const technicianIds = items.map((i) => i.technicianId);
    expect(technicianIds).toContain(ids.freeTechId);
    expect(technicianIds).not.toContain(ids.midBusyTechId);
    // الشغل بالساعات في نص المدى برضه بيتحسب: الحجز الممتد بياخد اليوم بالكامل (720 دقيقة)،
    // فأي التزام تاني في نفس اليوم بيعدّي السقف.
    expect(technicianIds).not.toContain(ids.hoursBusyTechId);
  });

  it('الحمل بالدقايق (مش أيام) بيتحسب برضه: 10 ساعات محجوزة + 6 ساعات مطلوبة = فوق السقف', async () => {
    // حجز يوم واحد بالظبط في **يوم الشغل القائم**، بـ360 دقيقة. 600 + 360 = 960 > 720.
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, midSpanBusyDay, false, true, {
      durationMinutes: 360,
      estimatedDurationDays: null,
    });
    const technicianIds = items.map((i) => i.technicianId);
    expect(technicianIds).toContain(ids.freeTechId);
    expect(technicianIds).not.toContain(ids.hoursBusyTechId);

    // ونفس اليوم بحمل صغير (60 دقيقة): 600 + 60 = 660 ≤ 720 ⇒ لسه فيه متسع، بيفضل ظاهر.
    const { items: light } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, midSpanBusyDay, false, true, {
      durationMinutes: 60,
      estimatedDurationDays: null,
    });
    expect(light.map((i) => i.technicianId)).toContain(ids.hoursBusyTechId);
  });

  it('«متعارض جدوليًا» بيتقاس بنفس الحمل — الفني بيظهر schedule_conflicted مش يختفي بلا سبب', async () => {
    const { items } = await service.listForServiceBooking(
      ids.serviceShowConflictedId,
      ids.addressId,
      undefined,
      bookingStart,
      false,
      true,
      { durationMinutes: null, estimatedDurationDays: CONTRACT_DAYS },
    );
    const midBusy = items.find((i) => i.technicianId === ids.midBusyTechId);
    expect(midBusy).toBeDefined();
    expect(midBusy?.availabilityStatus).toBe('schedule_conflicted');
    expect(items.find((i) => i.technicianId === ids.freeTechId)?.availabilityStatus).toBe('available');
  });

  it('hasEligibleTechnicianForDate() لفني بعينه بتتبع نفس القاعدة (مسار الاقتراح/إعادة الجدولة)', async () => {
    const withoutLoad = await service.hasEligibleTechnicianForDate(ids.serviceId, ids.zoneId, ids.addressId, bookingStart, ids.midBusyTechId);
    expect(withoutLoad).toBe(true);
    const withLoad = await service.hasEligibleTechnicianForDate(
      ids.serviceId,
      ids.zoneId,
      ids.addressId,
      bookingStart,
      ids.midBusyTechId,
      undefined,
      { durationMinutes: null, estimatedDurationDays: CONTRACT_DAYS },
    );
    expect(withLoad).toBe(false);
  });
});
