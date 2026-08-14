import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { TechnicianKpiSnapshot } from '../technician-kpi/entities/technician-kpi-snapshot.entity';
import { TechnicianProductivityService } from './technician-productivity.service';
import { DEFAULT_PRODUCTIVITY_METRICS_CONFIG } from './productivity-metrics-config';

// اختبار حي ضد Postgres حقيقي — إنتاجية configurable (docs/08 §14). بيثبت: التجميع عبر فترة
// (مش شهر واحد)، استبعاد مقياس لعينة غير كافية، وإن تعطيل مقياس من الإعدادات بيغيّر النتيجة فعليًا
// (توزيع الأوزان يعيد نفسه تلقائي على الباقي)، بلا أي بيانات مصطنعة — snapshots حقيقية في القاعدة.
describe('TechnicianProductivityService — تجميع حقيقي عبر فترة + configurability (§14)', () => {
  let dataSource: DataSource;
  let settingsService: SettingsService;
  let service: TechnicianProductivityService;
  let cache: RedisCacheService;

  const runId = Date.now().toString().slice(-8);
  let technicianId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianKpiSnapshot, Setting],
    });
    await dataSource.initialize();

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    service = new TechnicianProductivityService(dataSource.getRepository(TechnicianKpiSnapshot), settingsService);

    // technician_kpi_snapshots.technician_id بيربط بـ technician_profiles(id) فعليًا (مش users) —
    // لازم مستخدم + بروفايل فني حقيقيين عشان الـ FK ما يرفضش الـ insert. راجع نفس النمط في
    // matching.service.spec.ts.
    const [technicianUser] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2012${runId}`.slice(0, 14), `فني إنتاجية اختبار ${runId}`],
    );
    const [technicianProfile] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty)
       VALUES ($1,$2,'new','approved',true,true) RETURNING id`,
      [technicianUser.id, `PRD${runId}`.slice(0, 20)],
    );
    technicianId = technicianProfile.id;

    // 3 شهور من snapshots حقيقية لنفس الفني — بيانات مختلفة كل شهر عمدًا عشان نثبت التجميع
    // بيحصل فعليًا عبر الفترة، مش بيقرا شهر واحد بس.
    const months = [
      { year: 2026, month: 6, completed: 10, completion_rate: 80, acceptance_rate: 70, cancellation_rate: 10, complaints: 1, rating: 4.0, ratingsCount: 8, orderValue: 500000, overallScore: 75 },
      { year: 2026, month: 7, completed: 15, completion_rate: 85, acceptance_rate: 75, cancellation_rate: 5, complaints: 0, rating: 4.5, ratingsCount: 12, orderValue: 700000, overallScore: 82 },
      { year: 2026, month: 8, completed: 20, completion_rate: 90, acceptance_rate: 80, cancellation_rate: 5, complaints: 1, rating: 4.2, ratingsCount: 18, orderValue: 900000, overallScore: 88 },
    ];
    for (const m of months) {
      await dataSource.query(
        `INSERT INTO technician_kpi_snapshots
          (technician_id, period_year, period_month, offered_orders_count, accepted_orders_count, completed_orders_count,
           technician_cancelled_count, acceptance_rate, completion_rate, cancellation_rate, average_rating, ratings_count,
           complaints_count, platform_revenue_cents, technician_earnings_cents, order_value_cents, overall_score, calculated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())`,
        [
          technicianId, m.year, m.month, m.completed + 5, m.completed + 2, m.completed,
          1, m.acceptance_rate, m.completion_rate, m.cancellation_rate, m.rating, m.ratingsCount,
          m.complaints, m.orderValue, Math.round(m.orderValue * 0.8), m.orderValue, m.overallScore,
        ],
      );
    }
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM technician_kpi_snapshots WHERE technician_id = $1`, [technicianId]);
    const [profile] = await dataSource.query(`SELECT user_id FROM technician_profiles WHERE id = $1`, [
      technicianId,
    ]);
    await dataSource.query(`DELETE FROM technician_profiles WHERE id = $1`, [technicianId]);
    if (profile) await dataSource.query(`DELETE FROM users WHERE id = $1`, [profile.user_id]);
    await dataSource.query(
      `UPDATE settings SET value = $1 WHERE key = 'productivity.metrics_config'`,
      [JSON.stringify(DEFAULT_PRODUCTIVITY_METRICS_CONFIG)],
    );
    await cache.del('settings:productivity.metrics_config');
    await dataSource.destroy();
    cache.onModuleDestroy();
  });

  it('بيجمّع عبر 3 شهور فعليًا (مش شهر واحد بس) ويرجّع تقرير قابل للتفسير', async () => {
    const report = await service.computeForTechnician(technicianId, 3);

    expect(report.snapshots_found).toBe(3);
    expect(report.overall_score).not.toBeNull();
    expect(report.overall_score).toBeGreaterThan(0);
    expect(report.overall_score).toBeLessThanOrEqual(100);

    const completedOrdersMetric = report.breakdown.find((b) => b.key === 'completed_orders');
    expect(completedOrdersMetric?.raw_value).toBe(10 + 15 + 20); // مجموع حقيقي عبر الـ3 شهور
    expect(completedOrdersMetric?.included).toBe(true);

    const kpiMetric = report.breakdown.find((b) => b.key === 'monthly_kpi_score');
    expect(kpiMetric?.raw_value).toBeCloseTo((75 + 82 + 88) / 3, 1);
  });

  it('فترة شهر واحد بس بتاخد آخر شهر فقط (بيانات أغسطس، مش يونيو)', async () => {
    const report = await service.computeForTechnician(technicianId, 1);
    expect(report.snapshots_found).toBe(1);
    const completedOrdersMetric = report.breakdown.find((b) => b.key === 'completed_orders');
    expect(completedOrdersMetric?.raw_value).toBe(20); // شهر أغسطس بس
  });

  it('مقياس متعطّل من الإعدادات بيتستبعد فعليًا من الحساب (configurability حقيقية، مش تجاهل)', async () => {
    const customConfig = {
      ...DEFAULT_PRODUCTIVITY_METRICS_CONFIG,
      revenue_delivered: { ...DEFAULT_PRODUCTIVITY_METRICS_CONFIG.revenue_delivered, enabled: false },
    };
    await dataSource.query(
      `INSERT INTO settings (key, value, value_type, group_name) VALUES ('productivity.metrics_config', $1, 'json', 'productivity')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(customConfig)],
    );
    // تعديل مباشر بالـ SQL بيتخطى SettingsService.update() (اللي بيبطّل الكاش تلقائي) — لازم
    // نبطّل الكاش يدويًا هنا وإلا القراءة الجاية هترجّع القيمة القديمة المخزّنة (TTL دقيقة).
    await cache.del('settings:productivity.metrics_config');

    const report = await service.computeForTechnician(technicianId, 3);
    const revenueMetric = report.breakdown.find((b) => b.key === 'revenue_delivered');
    expect(revenueMetric?.enabled).toBe(false);
    expect(revenueMetric?.included).toBe(false);
    expect(revenueMetric?.normalized_score).toBeNull();

    // نرجّع الإعداد الافتراضي عشان مانأثرش على أي حاجة تانية بعد الاختبار ده
    await dataSource.query(
      `INSERT INTO settings (key, value, value_type, group_name) VALUES ('productivity.metrics_config', $1, 'json', 'productivity')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(DEFAULT_PRODUCTIVITY_METRICS_CONFIG)],
    );
    await cache.del('settings:productivity.metrics_config');
  });

  it('حجم عينة أدنى أكبر من المتاح بيستبعد المقياس بسبب واضح (مش صفر صامت)', async () => {
    const customConfig = {
      ...DEFAULT_PRODUCTIVITY_METRICS_CONFIG,
      customer_rating: { ...DEFAULT_PRODUCTIVITY_METRICS_CONFIG.customer_rating, minSampleSize: 10 },
    };
    await dataSource.query(
      `UPDATE settings SET value = $1 WHERE key = 'productivity.metrics_config'`,
      [JSON.stringify(customConfig)],
    );
    await cache.del('settings:productivity.metrics_config');

    const report = await service.computeForTechnician(technicianId, 3);
    const ratingMetric = report.breakdown.find((b) => b.key === 'customer_rating');
    expect(ratingMetric?.included).toBe(false);
    expect(ratingMetric?.exclusion_reason).toContain('عينة غير كافية');

    await dataSource.query(
      `UPDATE settings SET value = $1 WHERE key = 'productivity.metrics_config'`,
      [JSON.stringify(DEFAULT_PRODUCTIVITY_METRICS_CONFIG)],
    );
    await cache.del('settings:productivity.metrics_config');
  });

  it('فني بلا أي snapshots: صفر استثناء، درجة null مع تفسير واضح', async () => {
    const emptyTechnicianId = randomUUID();
    const report = await service.computeForTechnician(emptyTechnicianId, 3);
    expect(report.snapshots_found).toBe(0);
    expect(report.overall_score).toBeNull();
    expect(report.explanation).toContain('مفيش بيانات كفاية');
  });
});
