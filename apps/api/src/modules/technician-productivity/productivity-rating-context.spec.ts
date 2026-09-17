import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { TechnicianKpiSnapshot } from '../technician-kpi/entities/technician-kpi-snapshot.entity';
import { TechnicianProductivityService } from './technician-productivity.service';
import { DEFAULT_PRODUCTIVITY_METRICS_CONFIG } from './productivity-metrics-config';

/**
 * **سياق التقييمات في تقرير الإنتاجية** (بلاغ مالك 2026-09-17، ADR-0105).
 *
 * البلاغ كان لقطة: بروفايل الفني بيقول «متوسط التقييم: 4.26 (19 تقييم)»، وتحتها تقرير الإنتاجية
 * بيقول «تقييم العملاء — عينة غير كافية». التحقيق الحي (`scripts/verify-kpi-rating-sample.js`)
 * أثبت إن **مفيش فلتر غلط ولا ID غلط**: البروفايل والـKPI بيستخدموا نفس الفلتر بالحرف
 * (`customer_to_technician` + `is_published`)، والفرق الوحيد هو **الزمن**:
 *
 *   - البروفايل: حيّ، مدى الحياة.
 *   - الإنتاجية: مجمّد، شهري، من `technician_kpi_snapshots`.
 *
 * الاختبارات دي بتثبّت الفروق دي كعقد صريح، عشان أي تعديل بعد كده يكسرها بدل ما يرجّع اللبس.
 * كلها ضد Postgres حقيقي — `ratings` و`technician_kpi_snapshots` صفوف فعلية.
 */
describe('تقرير الإنتاجية — سياق التقييمات يفرّق بين مدى الحياة والفترة (بلاغ مالك 2026-09-17)', () => {
  let dataSource: DataSource;
  let service: TechnicianProductivityService;
  let cache: RedisCacheService;

  const runId = Date.now().toString().slice(-8);
  let technicianId: string;
  let technicianUserId: string;
  let customerUserId: string;
  let customerProfileId: string;
  let serviceId: string;
  let zoneId: string;
  let cityId: string;
  let categoryId: string;
  let addressId: string;

  /** بيحقن snapshot بقيم التقييم اللي إحنا عايزينها بالظبط — بيمثّل «الحساب وقته». */
  const seedSnapshot = async (year: number, month: number, averageRating: number | null, ratingsCount: number) => {
    await dataSource.query(
      `INSERT INTO technician_kpi_snapshots
         (technician_id, period_year, period_month, offered_orders_count, accepted_orders_count,
          completed_orders_count, technician_cancelled_count, acceptance_rate, completion_rate,
          cancellation_rate, average_rating, ratings_count, complaints_count, platform_revenue_cents,
          technician_earnings_cents, order_value_cents, overall_score, calculated_at)
       VALUES ($1,$2,$3,10,8,8,0,80,80,5,$4,$5,0,100000,80000,100000,75, now())
       ON CONFLICT (technician_id, period_year, period_month)
       DO UPDATE SET average_rating = $4, ratings_count = $5, calculated_at = now()`,
      [technicianId, year, month, averageRating, ratingsCount],
    );
  };

  /** تقييم حقيقي على طلب حقيقي — `created_at` صريح عشان نتحكم في وقوعه داخل/خارج الفترة. */
  const seedRating = async (
    tag: string,
    createdAt: Date,
    { stars = 4, published = true, type = 'customer_to_technician' } = {},
  ) => {
    const [order] = await dataSource.query(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
         required_technicians, required_assistants, placed_at, work_started_at, work_completed_at,
         total_amount_cents, payment_method, payment_status, commission_rate_applied, problem_description)
       VALUES ($1,$2,$3,$4,$5,'completed','individual',$6,120,$7,1,0,$6,$6,$6,30000,'cash','paid',20.00,'x')
       RETURNING id`,
      [customerProfileId, serviceId, addressId, zoneId, `PRC-${runId}-${tag}`, createdAt.toISOString(), technicianId],
    );
    await dataSource.query(
      `INSERT INTO ratings (order_id, rated_by_user_id, rated_user_id, rating_type, overall_rating, is_published, created_at)
       VALUES ($1,$2,$3,$4::rating_type,$5,$6,$7)`,
      [order.id, customerUserId, technicianUserId, type, stars, published, createdAt.toISOString()],
    );
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianKpiSnapshot, Setting],
    });
    await dataSource.initialize();

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(
      dataSource.getRepository(Setting),
      {} as unknown as AuditLogService,
      cache,
    );
    service = new TechnicianProductivityService(
      dataSource.getRepository(TechnicianKpiSnapshot),
      settingsService,
      dataSource,
    );

    const [techUser] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2013${runId}`.slice(0, 14), `فني سياق تقييم ${runId}`],
    );
    technicianUserId = techUser.id;
    const [techProfile] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty)
       VALUES ($1,$2,'new','approved',true,true) RETURNING id`,
      [technicianUserId, `PRC${runId}`.slice(0, 20)],
    );
    technicianId = techProfile.id;

    const [custUser] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2014${runId}`.slice(0, 14), `عميل سياق تقييم ${runId}`],
    );
    customerUserId = custUser.id;
    const [custProfile] = await dataSource.query(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [customerUserId],
    );
    customerProfileId = custProfile.id;

    // كتالوج/جغرافيا أدنى ما يلزم للـFK بتاعة الطلبات — نفس شكل الـfixture المستخدم في
    // `admin-order-timeline.spec.ts` بالحرف (نطاق خاص بالملف ده، مش `SELECT … LIMIT 1` مقترَض).
    const [country] = await dataSource.query(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    const [city] = await dataSource.query(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `prc-city-${runId}`],
    );
    cityId = city.id;
    const [zone] = await dataSource.query(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [cityId, `نطاق ${runId}`, `zone ${runId}`],
    );
    zoneId = zone.id;
    const [address] = await dataSource.query(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [customerUserId, `شارع ${runId}`],
    );
    addressId = address.id;
    const [category] = await dataSource.query(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ${runId}`, `cat ${runId}`, `prc-cat-${runId}`],
    );
    categoryId = category.id;
    const [svc] = await dataSource.query(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
      [categoryId, `خدمة ${runId}`, `prc-svc-${runId}`],
    );
    serviceId = svc.id;

    await dataSource.query(`UPDATE settings SET value = $1 WHERE key = 'productivity.metrics_config'`, [
      JSON.stringify(DEFAULT_PRODUCTIVITY_METRICS_CONFIG),
    ]);
    await cache.del('settings:productivity.metrics_config');
  });

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM ratings WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`,
      [`PRC-${runId}-%`],
    );
    await dataSource.query(`DELETE FROM orders WHERE order_number LIKE $1`, [`PRC-${runId}-%`]);
    await dataSource.query(`DELETE FROM technician_kpi_snapshots WHERE technician_id = $1`, [technicianId]);
    await dataSource.query(`DELETE FROM addresses WHERE id = $1`, [addressId]);
    await dataSource.query(`DELETE FROM services WHERE id = $1`, [serviceId]);
    await dataSource.query(`DELETE FROM service_categories WHERE id = $1`, [categoryId]);
    await dataSource.query(`DELETE FROM service_zones WHERE id = $1`, [zoneId]);
    await dataSource.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
    await dataSource.query(`DELETE FROM technician_profiles WHERE id = $1`, [technicianId]);
    await dataSource.query(`DELETE FROM customer_profiles WHERE id = $1`, [customerProfileId]);
    await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [[technicianUserId, customerUserId]]);
    await dataSource.destroy();
    cache.onModuleDestroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      `DELETE FROM ratings WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`,
      [`PRC-${runId}-%`],
    );
    await dataSource.query(`DELETE FROM orders WHERE order_number LIKE $1`, [`PRC-${runId}-%`]);
    await dataSource.query(`DELETE FROM technician_kpi_snapshots WHERE technician_id = $1`, [technicianId]);
  });

  it('أكتر من تقييم في شهر واحد: `sample_size` = 1 شهر، والعدد الفعلي للتقييمات منفصل', async () => {
    await seedSnapshot(2026, 5, 4.5, 4);
    for (let i = 0; i < 4; i += 1) {
      await seedRating(`m1-${i}`, new Date(Date.UTC(2026, 4, 5 + i)), { stars: 5 });
    }

    const report = await service.computeForTechnician(technicianId, 1);
    const rating = report.breakdown.find((b) => b.key === 'customer_rating');

    // **ده أصل اللبس**: المقياس داخل بعينة «١»، بس التقييمات الفعلية أربعة.
    expect(rating?.included).toBe(true);
    expect(rating?.sample_size).toBe(1);
    expect(report.rating_context.months_with_rating_data).toBe(1);
    expect(report.rating_context.period_ratings_count).toBe(4);
    expect(report.rating_context.lifetime_ratings_count).toBe(4);
    expect(report.rating_context.is_stale).toBe(false);
  });

  it('تقييم قديم بره الفترة: بيظهر في مدى الحياة بس، والإنتاجية مابتشوفهوش', async () => {
    await seedSnapshot(2026, 5, 4.0, 2);
    await seedRating('in-1', new Date(Date.UTC(2026, 4, 10)), { stars: 4 });
    await seedRating('in-2', new Date(Date.UTC(2026, 4, 11)), { stars: 4 });
    // تقييم من شهر مالوش snapshot في النافذة خالص
    await seedRating('old', new Date(Date.UTC(2026, 0, 3)), { stars: 5 });

    const report = await service.computeForTechnician(technicianId, 1);

    expect(report.rating_context.lifetime_ratings_count).toBe(3);
    expect(report.rating_context.period_ratings_count).toBe(2);
    expect(report.rating_context.live_ratings_in_period).toBe(2);
    // التقييم القديم **مش** تقادم — هو بره النافذة أصلاً.
    expect(report.rating_context.is_stale).toBe(false);
    expect(report.period_start).toBe(new Date(Date.UTC(2026, 4, 1)).toISOString());
    expect(report.period_end).toBe(new Date(Date.UTC(2026, 5, 1)).toISOString());
  });

  it('تقييم غير منشور: مستبعد من مدى الحياة ومن الفترة بنفس القاعدة — مش تقادم', async () => {
    await seedSnapshot(2026, 5, 4.0, 1);
    await seedRating('pub', new Date(Date.UTC(2026, 4, 10)), { stars: 4 });
    await seedRating('unpub', new Date(Date.UTC(2026, 4, 12)), { stars: 1, published: false });

    const report = await service.computeForTechnician(technicianId, 1);

    expect(report.rating_context.lifetime_ratings_count).toBe(1);
    expect(report.rating_context.live_ratings_in_period).toBe(1);
    expect(report.rating_context.period_ratings_count).toBe(1);
    expect(report.rating_context.is_stale).toBe(false);
  });

  it('تقييم `technician_to_customer`: مستبعد من الاتنين — النوع بيتفلتر بنفس الشكل', async () => {
    await seedSnapshot(2026, 5, 4.0, 1);
    await seedRating('c2t', new Date(Date.UTC(2026, 4, 10)), { stars: 4 });
    await seedRating('t2c', new Date(Date.UTC(2026, 4, 12)), { stars: 1, type: 'technician_to_customer' });

    const report = await service.computeForTechnician(technicianId, 1);

    expect(report.rating_context.lifetime_ratings_count).toBe(1);
    expect(report.rating_context.period_ratings_count).toBe(1);
    expect(report.rating_context.is_stale).toBe(false);
  });

  it('**تقييم جديد بعد الـsnapshot: بيتعلّم عليه كتقادم بعدد التقييمات الناقصة**', async () => {
    // الـsnapshot اتحسب والشهر كان فاضي من التقييمات
    await seedSnapshot(2026, 5, null, 0);
    // وبعدين وصلوا تلات تقييمات جوّه نفس الشهر
    await seedRating('late-1', new Date(Date.UTC(2026, 4, 20)), { stars: 5 });
    await seedRating('late-2', new Date(Date.UTC(2026, 4, 21)), { stars: 5 });
    await seedRating('late-3', new Date(Date.UTC(2026, 4, 22)), { stars: 4 });

    const report = await service.computeForTechnician(technicianId, 1);
    const rating = report.breakdown.find((b) => b.key === 'customer_rating');

    // المقياس لسه مستبعد (الـKPI مجمّد عن قصد — ملزوق بالصرف)، **بس السبب بقى مفهوم**.
    expect(rating?.included).toBe(false);
    expect(rating?.exclusion_reason).toContain('ولا شهر');
    expect(report.rating_context.lifetime_ratings_count).toBe(3);
    expect(report.rating_context.live_ratings_in_period).toBe(3);
    expect(report.rating_context.period_ratings_count).toBe(0);
    expect(report.rating_context.ratings_missing_from_snapshots).toBe(3);
    expect(report.rating_context.is_stale).toBe(true);

    // وإعادة حساب الشهر (الإجراء اليدوي الموجود أصلاً) بتقفل الفرق — مفيش أوتوماتيك مالي.
    await seedSnapshot(2026, 5, 4.67, 3);
    const after = await service.computeForTechnician(technicianId, 1);
    expect(after.rating_context.is_stale).toBe(false);
    expect(after.rating_context.ratings_missing_from_snapshots).toBe(0);
    expect(after.breakdown.find((b) => b.key === 'customer_rating')?.included).toBe(true);
  });

  it('أكتر من شهر فيه تقييمات: العينة بالشهور، والمتوسط موزون بعدد تقييمات كل شهر', async () => {
    await seedSnapshot(2026, 4, 3.0, 2); // شهر ضعيف، تقييمين
    await seedSnapshot(2026, 5, 5.0, 8); // شهر قوي، تمن تقييمات
    for (let i = 0; i < 2; i += 1) await seedRating(`apr-${i}`, new Date(Date.UTC(2026, 3, 5 + i)), { stars: 3 });
    for (let i = 0; i < 8; i += 1) await seedRating(`may-${i}`, new Date(Date.UTC(2026, 4, 5 + i)), { stars: 5 });

    const report = await service.computeForTechnician(technicianId, 2);
    const rating = report.breakdown.find((b) => b.key === 'customer_rating');

    expect(report.snapshots_found).toBe(2);
    expect(rating?.sample_size).toBe(2);
    expect(report.rating_context.months_with_rating_data).toBe(2);
    expect(report.rating_context.period_ratings_count).toBe(10);
    // موزون: (3×2 + 5×8) / 10 = 4.6 — **مش** المتوسط البسيط للشهرين (4.0).
    expect(report.rating_context.period_average).toBeCloseTo(4.6, 2);
    expect(rating?.raw_value).toBeCloseTo(4.6, 2);
    expect(report.rating_context.is_stale).toBe(false);
    // والشهور اللي التقرير مبني عليها ظاهرة بالاسم.
    expect(report.snapshot_periods.map((p) => `${p.period_year}-${p.period_month}`).sort()).toEqual([
      '2026-4',
      '2026-5',
    ]);
  });
});
