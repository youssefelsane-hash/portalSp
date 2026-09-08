import { DataSource } from 'typeorm';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import {
  technicianAvailabilityCondition,
  technicianIndividualVisibilityCondition,
} from './technician-eligibility.sql';
import { DAILY_CAPACITY_MINUTES_FALLBACK } from './technician-day-capacity.sql';

/**
 * **ADR-0080 — الشركة مظلّة لأعضاء عاديين** (طلب مالك صريح، 2026-09-06):
 *
 * > «الشركة يبقى داخلها الأشخاص، والأشخاص دول بيتعاملوا عادي زيهم زي الفنيين بالضبط، ولكن هم
 * >  تابعين للشركة… الشركة ممكن يكون عندها نجارين وبوابين وحدادين، فمش منطقي إني أدي للشركة
 * >  كل الفئات — ما كده ممكن شغل البواب يروح للحداد… لما شخص يختار شركة، الـauto matching
 * >  بيختار أي حد من الناس المسموح لها تشتغل في المنطقة وفي الكاتيجوري دي من جوّه الشركة.»
 *
 * > «عايز زرار عند كل فني داخل في شركة… لو متفعل، الفني ده ما بيظهرش أصلًا إن هو فرد لوحده،
 * >  كأنه مش متسجل معانا، هو فقط تابع للشركة.»
 *
 * الاختبار بينفّذ الشرط الحقيقي اللي التوزيع بيستخدمه على قاعدة بيانات حقيقية.
 */
describe('الشركة مظلّة لأعضاء عاديين (ADR-0080)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    category: '', carpentryService: '', smithService: '',
    city: '', zone: '', otherZone: '', address: '',
    company: '', carpenter: '', carpenterUser: '', smith: '', smithUser: '',
    exclusive: '', exclusiveUser: '', solo: '', soloUser: '',
    customer: '', customerProfile: '',
  };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  /**
   * نفس بوابة الأهلية اللي `MatchingService.findEligibleTechnicians()` بتستخدمها بالحرف:
   * خدمة + منطقة + توافر + **رؤية كفرد**، مع تقييد اختياري بشركة (`companyId`).
   */
  const eligibleIds = async (serviceId: string, zoneId: string, companyId: string | null): Promise<string[]> => {
    const rows = await q<{ id: string }>(
      `SELECT tp.id
         FROM technician_profiles tp
         LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1
           AND ts.is_active = true AND ts.verification_status = 'approved'
         JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
         JOIN services svc ON svc.id = $1
        WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
          AND tp.current_location IS NOT NULL
          AND ts.id IS NOT NULL
          AND ($3::uuid IS NULL OR tp.company_id = $3)
          AND ${technicianIndividualVisibilityCondition({ technicianAlias: 'tp', companyScopeParam: '$3' })}
          ${technicianAvailabilityCondition({
            technicianIdExpr: 'tp.id',
            scheduledAtParam: 'NULL',
            excludeOrderIdParam: 'NULL',
            activeStatusesParam: '$4',
            engagedStatusesParam: '$5',
            isEmergencyParam: '$6',
            serviceDurationExpr: '60',
            dailyCapacityMinutesParam: '$7',
          })}`,
      [serviceId, zoneId, companyId, ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES, false, DAILY_CAPACITY_MINUTES_FALLBACK],
    );
    return rows.map((r) => r.id).sort();
  };

  const makeTechnician = async (label: string, companyId: string | null): Promise<{ profileId: string; userId: string }> => {
    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2087${runId}${label}`.slice(0, 15), `فني ${label} ${runId}`],
    );
    const [p] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, company_id, current_location)
       VALUES ($1,$2,'approved',$3, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) RETURNING id`,
      [u.id, `CAP-${runId}-${label}`, companyId],
    );
    return { profileId: p.id, userId: u.id };
  };

  const qualify = async (technicianId: string, serviceId: string, zoneId: string): Promise<void> => {
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [technicianId, serviceId],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      technicianId,
      zoneId,
    ]);
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`شركة ${runId}`, `co ${runId}`, `co-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const mkService = async (label: string): Promise<string> => {
      const [svc] = await q(
        `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, estimated_duration_minutes, pricing_model)
         VALUES ($1,$2,$3,$4,10000,60,'formula') RETURNING id`,
        [ids.category, `${label} ${runId}`, `${label} ${runId}`, `co-${label}-${runId.toLowerCase()}`],
      );
      return svc.id;
    };
    ids.carpentryService = await mkService('نجارة');
    ids.smithService = await mkService('حدادة');

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `co-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة ${runId}`, `zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [otherZone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة تانية ${runId}`, `zone2 ${runId}`,
    ]);
    ids.otherZone = otherZone.id;

    // الشركة + أعضاؤها: نجّار (منطقتنا) وحدّاد (منطقة تانية) — عمدًا تخصصين ومنطقتين مختلفين.
    const carpenter = await makeTechnician('C', null);
    ids.carpenter = carpenter.profileId;
    ids.carpenterUser = carpenter.userId;
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
      [ids.carpenterUser, `شركة ${runId}`],
    );
    ids.company = company.id;
    await q(`UPDATE technician_profiles SET company_id = $1 WHERE id = $2`, [ids.company, ids.carpenter]);
    await qualify(ids.carpenter, ids.carpentryService, ids.zone);

    const smith = await makeTechnician('S', ids.company);
    ids.smith = smith.profileId;
    ids.smithUser = smith.userId;
    await qualify(ids.smith, ids.smithService, ids.otherZone);

    // عضو حصري للشركة — نفس تخصص ومنطقة النجّار بالظبط، عشان الفرق الوحيد يبقى العلم.
    const exclusive = await makeTechnician('X', ids.company);
    ids.exclusive = exclusive.profileId;
    ids.exclusiveUser = exclusive.userId;
    await qualify(ids.exclusive, ids.carpentryService, ids.zone);
    await q(`UPDATE technician_profiles SET company_exclusive = true WHERE id = $1`, [ids.exclusive]);

    // فني مستقل تمامًا بنفس التخصص والمنطقة — خط الأساس.
    const solo = await makeTechnician('I', null);
    ids.solo = solo.profileId;
    ids.soloUser = solo.userId;
    await qualify(ids.solo, ids.carpentryService, ids.zone);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const techs = [ids.carpenter, ids.smith, ids.exclusive, ids.solo].filter(Boolean);
    const users = [ids.carpenterUser, ids.smithUser, ids.exclusiveUser, ids.soloUser, ids.customer].filter(Boolean);
    try {
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [techs]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [techs]);
      await q(`UPDATE technician_profiles SET company_exclusive = false WHERE id = ANY($1)`, [techs]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [techs]);
      await q(`DELETE FROM technician_companies WHERE id = ANY($1)`, [ids.company ? [ids.company] : []]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.carpentryService, ids.smithService].filter(Boolean)]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [ids.category ? [ids.category] : []]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [[ids.zone, ids.otherZone].filter(Boolean)]);
      await q(`DELETE FROM cities WHERE id = ANY($1)`, [ids.city ? [ids.city] : []]);
    } finally {
      await dataSource.destroy();
    }
  });

  // ===== جوهر النموذج: نطاق العضو هو الحاكم، مش «كل فئات الشركة» =====
  it('شغل النجارة جوّه الشركة بيروح للنجّار بس — الحدّاد مايوصلوش (بلاغ المالك بالحرف)', async () => {
    const inCompany = await eligibleIds(ids.carpentryService, ids.zone, ids.company);
    expect(inCompany).toContain(ids.carpenter);
    expect(inCompany).not.toContain(ids.smith);
  });

  it('الحدّاد في منطقة تانية — شغل الحدادة في منطقتنا مايوصلوش', async () => {
    expect(await eligibleIds(ids.smithService, ids.zone, ids.company)).toHaveLength(0);
    expect(await eligibleIds(ids.smithService, ids.otherZone, ids.company)).toEqual([ids.smith]);
  });

  it('التوزيع جوّه الشركة مابيخرجش منها — الفني المستقل مش مرشّح', async () => {
    expect(await eligibleIds(ids.carpentryService, ids.zone, ids.company)).not.toContain(ids.solo);
  });

  // ===== زرار «حصري للشركة» =====
  it('العضو الحصري مايظهرش في التوزيع العام خالص', async () => {
    const openPool = await eligibleIds(ids.carpentryService, ids.zone, null);
    expect(openPool).toContain(ids.solo);
    expect(openPool).toContain(ids.carpenter); // عضو شركة عادي بيفضل ظاهر كفرد
    expect(openPool).not.toContain(ids.exclusive);
  });

  it('نفس العضو الحصري بيوصله شغل عادي لما التوزيع يبقى جوّه شركته', async () => {
    expect(await eligibleIds(ids.carpentryService, ids.zone, ids.company)).toContain(ids.exclusive);
  });

  it('إطفاء الزرار بيرجّعه فرد عادي فورًا', async () => {
    await q(`UPDATE technician_profiles SET company_exclusive = false WHERE id = $1`, [ids.exclusive]);
    expect(await eligibleIds(ids.carpentryService, ids.zone, null)).toContain(ids.exclusive);
    await q(`UPDATE technician_profiles SET company_exclusive = true WHERE id = $1`, [ids.exclusive]);
  });

  it('القاعدة بترفض «حصري لشركة» لفني مستقل', async () => {
    await expect(
      q(`UPDATE technician_profiles SET company_exclusive = true WHERE id = $1`, [ids.solo]),
    ).rejects.toThrow(/chk_technician_profiles_company_exclusive_needs_company/);
  });
});
