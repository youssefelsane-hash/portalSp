import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';

/**
 * Script 6 Part 9 — ترتيب السوق الافتراضي ("الأنسب") لازم يبقى محرك توصية بمرحلتين، مش
 * `ORDER BY average_rating DESC` مباشر. الاختبار ده بيثبت المثال بالحرف اللي التصميم اتبنى عليه:
 * فني بتقييم 5.0 من مراجعة واحدة لازم **يترتب بعد** فني بتقييم 4.9 من 200 مراجعة، لأن الأول
 * لسه معندوش ثقة إحصائية كافية (v=1 < بارامتر العتبة m=5)، فالمتوسط البايزي بيسحبه ناحية
 * المتوسط الافتراضي (4.0) أكتر بكتير من الفني التاني اللي عنده حجم عينة كبير.
 */
describe('TechniciansService.listForServiceBooking — ترتيب التوصية البايزي (Script 6 Part 9)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechniciansService;
  const runId = Date.now().toString(36);
  const ids = {
    countryId: '',
    cityId: '',
    zoneId: '',
    addressUserId: '',
    addressId: '',
    categoryId: '',
    serviceId: '',
    lowVolumeUserId: '',
    lowVolumeTechId: '',
    highVolumeUserId: '',
    highVolumeTechId: '',
    orderCustomerUserId: '',
    orderCustomerProfileId: '',
    orderId: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, City, Area, ServiceZone],
    });
    await dataSource.initialize();

    const [country] = await dataSource.query(`SELECT id FROM countries LIMIT 1`);
    ids.countryId = country.id;
    const [category] = await dataSource.query(`SELECT id FROM service_categories LIMIT 1`);
    ids.categoryId = category.id;

    const [city] = await dataSource.query(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.countryId, `مدينة ترتيب ${runId}`, `RankCity${runId}`, `rank-city-${runId}`],
    );
    ids.cityId = city.id;

    const [zone] = await dataSource.query(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق ترتيب ${runId}`, `RankZone${runId}`],
    );
    ids.zoneId = zone.id;

    const [addressUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2032${runId}`.slice(0, 15), `عميل ترتيب ${runId}`],
    );
    ids.addressUserId = addressUser.id;

    const [address] = await dataSource.query(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.addressUserId, ids.cityId, 'شارع الاختبار'],
    );
    ids.addressId = address.id;

    const [svc] = await dataSource.query(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'formula',10000,true) RETURNING id`,
      [ids.categoryId, `خدمة ترتيب ${runId}`, `rank-service-${runId}`],
    );
    ids.serviceId = svc.id;

    // فني منخفض الحجم: تقييم 5.0 من مراجعة واحدة بس
    const [lowVolumeUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2033${runId}`.slice(0, 15), `فني تقييم واحد ${runId}`],
    );
    ids.lowVolumeUserId = lowVolumeUser.id;
    const [lowVolumeTech] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,current_level,
          average_rating,total_ratings_count,current_location)
       VALUES ($1,$2,'x','approved','new',5.0,1, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography)
       RETURNING id`,
      [ids.lowVolumeUserId, `RNK1${runId}`.slice(0, 20)],
    );
    ids.lowVolumeTechId = lowVolumeTech.id;

    // فني عالي الحجم: تقييم 4.9 من 200 مراجعة
    const [highVolumeUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2034${runId}`.slice(0, 15), `فني 200 تقييم ${runId}`],
    );
    ids.highVolumeUserId = highVolumeUser.id;
    const [highVolumeTech] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,current_level,
          average_rating,total_ratings_count,current_location)
       VALUES ($1,$2,'x','approved','new',4.9,200, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography)
       RETURNING id`,
      [ids.highVolumeUserId, `RNK2${runId}`.slice(0, 20)],
    );
    ids.highVolumeTechId = highVolumeTech.id;

    for (const technicianId of [ids.lowVolumeTechId, ids.highVolumeTechId]) {
      await dataSource.query(
        `INSERT INTO technician_services (technician_id,service_id,is_active) VALUES ($1,$2,true)`,
        [technicianId, ids.serviceId],
      );
      await dataSource.query(
        `INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`,
        [technicianId, ids.zoneId],
      );
    }

    // طلب مكتمل واحد للفني منخفض الحجم — عشان نثبت on_time_rate/avg_arrival_minutes (Script 6
    // Part 7) بيتحسبوا صح من نفس منطق getPublicProfile() (correlated subquery في الاستعلام
    // الرئيسي). وصل بعد الموعد المجدول بـ5 دقايق (جوّه عتبة الـ15 دقيقة) = "في الميعاد"، ورحلة
    // 20 دقيقة (technician_departed_at→technician_arrived_at).
    const [orderCustomerUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2035${runId}`.slice(0, 15), `عميل طلب ${runId}`],
    );
    ids.orderCustomerUserId = orderCustomerUser.id;
    const [customerProfile] = await dataSource.query(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [ids.orderCustomerUserId],
    );
    ids.orderCustomerProfileId = customerProfile.id;
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number,customer_id,technician_id,service_id,address_id,scheduled_at,
          technician_departed_at,technician_arrived_at)
       VALUES ($1,$2,$3,$4,$5, now(), now() - interval '15 minutes', now() + interval '5 minutes')
       RETURNING id`,
      [`ORD-RANK-${runId}`.slice(0, 24), ids.orderCustomerProfileId, ids.lowVolumeTechId, ids.serviceId, ids.addressId],
    );
    ids.orderId = order.id;

    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
    const settingsServiceStub = {
      // القيم الافتراضية بالظبط زي التوثيق (m=5 عتبة، C=4.0 متوسط افتراضي) — نفس المثال المحسوب يدويًا.
      getNumber: async (_key: string, defaultValue: number) => defaultValue,
    };
    service = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never, // technicianCompanies
      {} as never, // technicianServices
      {} as never, // services
      dataSource.getRepository(User),
      {} as never, // portfolioLinksService
      {} as never, // certificatesService
      {} as never, // auditLog
      geoService,
      settingsServiceStub as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await dataSource.query(`DELETE FROM orders WHERE id=$1`, [ids.orderId]);
      await dataSource.query(`DELETE FROM customer_profiles WHERE id=$1`, [ids.orderCustomerProfileId]);
      await dataSource.query(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [
        ids.lowVolumeTechId,
        ids.highVolumeTechId,
      ]);
      await dataSource.query(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [
        ids.lowVolumeTechId,
        ids.highVolumeTechId,
      ]);
      await dataSource.query(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [
        ids.lowVolumeTechId,
        ids.highVolumeTechId,
      ]);
      await dataSource.query(`DELETE FROM addresses WHERE id=$1`, [ids.addressId]);
      await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
        ids.lowVolumeUserId,
        ids.highVolumeUserId,
        ids.addressUserId,
        ids.orderCustomerUserId,
      ]);
      await dataSource.query(`DELETE FROM services WHERE id=$1`, [ids.serviceId]);
      await dataSource.query(`DELETE FROM technician_zones WHERE service_zone_id=$1`, [ids.zoneId]);
      await dataSource.query(`DELETE FROM service_zones WHERE id=$1`, [ids.zoneId]);
      await dataSource.query(`DELETE FROM cities WHERE id=$1`, [ids.cityId]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('الفني بتقييم 4.9/200 مراجعة يسبق الفني بتقييم 5.0/مراجعة واحدة في الترتيب الافتراضي', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId);
    const ranked = items.filter((item) => [ids.lowVolumeTechId, ids.highVolumeTechId].includes(item.technicianId));
    expect(ranked).toHaveLength(2);
    expect(ranked[0].technicianId).toBe(ids.highVolumeTechId);
    expect(ranked[1].technicianId).toBe(ids.lowVolumeTechId);
  });

  it('القيم الخام (average_rating/total_ratings_count) لسه راجعة زي ما هي — الترتيب بس اتغير مش البيانات المعروضة', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId);
    const lowVolume = items.find((item) => item.technicianId === ids.lowVolumeTechId)!;
    const highVolume = items.find((item) => item.technicianId === ids.highVolumeTechId)!;
    expect(lowVolume.averageRating).toBe(5);
    expect(lowVolume.totalRatingsCount).toBe(1);
    expect(highVolume.averageRating).toBe(4.9);
    expect(highVolume.totalRatingsCount).toBe(200);
  });

  it('isVerified=false للاتنين (مفيش مِنحة أدمن)، وon_time_rate/avg_arrival_minutes بيتحسبوا من طلب حقيقي', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId);
    const lowVolume = items.find((item) => item.technicianId === ids.lowVolumeTechId)!;
    const highVolume = items.find((item) => item.technicianId === ids.highVolumeTechId)!;
    // ADR-0039 (docs/08 §62.1) — الاختبار ده كان بيتوقّع `true` لأن الحقل كان ثابت `true` في الكود
    // لكل صف. بقى مربوط بـ`is_trust_verified` اللي الأدمن بيمنحه، والفنيين دول مأخدوش أي مِنحة —
    // فـ`false` هي الإجابة الصحيحة دلوقتي. اعتمادهم التشغيلي (`approved`) لسه زي ما هو، وبيظهروا عادي.
    expect(lowVolume.isVerified).toBe(false);
    expect(highVolume.isVerified).toBe(false);
    // الفني منخفض الحجم عنده الطلب المزروع: وصل بعد الموعد بـ5 دقايق (جوّه عتبة الـ15) = 100%
    // التزام، ورحلة استغرقت 20 دقيقة (departed→arrived).
    expect(lowVolume.onTimeRatePercent).toBe(100);
    expect(lowVolume.avgArrivalMinutes).toBe(20);
    // الفني عالي الحجم معندوش أي طلبات — null صريح مش صفر مضلّل.
    expect(highVolume.onTimeRatePercent).toBeNull();
    expect(highVolume.avgArrivalMinutes).toBeNull();
  });
});
