import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';
import { ServiceZone } from './entities/service-zone.entity';
import { GeoService } from './geo.service';

/**
 * تدقيق T-1 — موديول `geo` كان **صفر اختبارات** رغم إنه أكبر موديول بلا تغطية (١١٠٠+ سطر)،
 * وفيه أخطر منطقين في تحديد الخدمة:
 *
 * 1. `findZoneForPoint()` — بحث point-in-polygon حقيقي بـPostGIS، وأهم حاجة فيه **سلوك
 *    الـfallback**: مدينة لسه معندهاش أي مضلّع بترجع لأول نطاق نشط (عشان مانكسرش المدن
 *    الحالية)، لكن مدينة عندها مضلّع واحد على الأقل بترفض أي إحداثية برّه المضلّعات صراحةً.
 *    القرار ده موثّق في الكود بس ماكانش متحقّق منه بأي اختبار — ولو حد «صلّحه» لـfallback
 *    دايم، الميزة كلها بتبطل من غير ما يفشل أي حاجة.
 * 2. `isAreaLaunchedInCity()` — اتكتبت أصلاً لإصلاح بَقّة حقيقية (عميل بيبعت `city_id` لمدينة
 *    و`area_id` لمنطقة في مدينة تانية، فيختار نطاق التسعير اللي يحبه). الإصلاح كان بلا اختبار.
 *
 * الاختبارات حيّة على Postgres/PostGIS حقيقي — `ST_Contains` مالوش أي معنى في mock.
 */
describe('GeoService (تدقيق T-1) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: GeoService;

  const runId = Date.now().toString(36);
  let cityId = '';
  let otherCityId = '';
  const created = { zones: [] as string[], areas: [] as string[] };

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  /** مضلّع مربّع بسيط حوالين نقطة — أوضح من إحداثيات حقيقية وبيختبر نفس الدالة بالظبط. */
  function squareAround(lng: number, lat: number, half: number): string {
    const pts = [
      [lng - half, lat - half],
      [lng + half, lat - half],
      [lng + half, lat + half],
      [lng - half, lat + half],
      [lng - half, lat - half],
    ];
    return `POLYGON((${pts.map(([x, y]) => `${x} ${y}`).join(', ')}))`;
  }

  async function insertZone(
    targetCityId: string,
    label: string,
    opts: { boundaryWkt?: string; isActive?: boolean; deleted?: boolean } = {},
  ): Promise<string> {
    const [row] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en, boundary, is_active, deleted_at)
       VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE ST_GeogFromText($4) END, $5, $6)
       RETURNING id`,
      [
        targetCityId,
        `نطاق ${label} ${runId}`,
        `Zone ${label} ${runId}`,
        opts.boundaryWkt ?? null,
        opts.isActive ?? true,
        opts.deleted === true ? new Date() : null,
      ],
    );
    created.zones.push(row.id);
    return row.id;
  }

  async function insertArea(
    targetCityId: string,
    label: string,
    opts: { launched?: boolean; active?: boolean } = {},
  ): Promise<string> {
    const [row] = await q<{ id: string }[]>(
      `INSERT INTO areas (city_id, name_ar, name_en, slug, is_active, is_launched)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        targetCityId,
        `منطقة ${label} ${runId}`,
        `Area ${label} ${runId}`,
        `area-${label}-${runId}`,
        opts.active ?? true,
        opts.launched ?? true,
      ],
    );
    created.areas.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [City, Area, ServiceZone],
    }).initialize();

    service = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );

    const [country] = await q<{ id: string }[]>(`SELECT id FROM countries LIMIT 1`);
    const mkCity = async (label: string): Promise<string> => {
      const [row] = await q<{ id: string }[]>(
        `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
        [country.id, `مدينة ${label} ${runId}`, `City ${label} ${runId}`, `city-${label}-${runId}`],
      );
      return row.id;
    };
    cityId = await mkCity('a');
    otherCityId = await mkCity('b');
  });

  afterAll(async () => {
    await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [created.zones]);
    await q(`DELETE FROM areas WHERE id = ANY($1)`, [created.areas]);
    await q(`DELETE FROM cities WHERE id = ANY($1)`, [[cityId, otherCityId]]);
    await dataSource.destroy();
  });

  afterEach(async () => {
    await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [created.zones]);
    await q(`DELETE FROM areas WHERE id = ANY($1)`, [created.areas]);
    created.zones = [];
    created.areas = [];
  });

  describe('findZoneForPoint — سلوك الـfallback هو جوهر الميزة', () => {
    it('مدينة مالهاش أي مضلّع: بترجع أول نطاق نشط مهما كانت الإحداثية (مانكسرش المدن الحالية)', async () => {
      const first = await insertZone(cityId, 'أول');
      await insertZone(cityId, 'تاني');

      // إحداثية في نص المحيط الهادي — لو كان فيه أي فحص جغرافي كانت هترجع null.
      const zone = await service.findZoneForPoint(cityId, 0, -150);
      expect(zone?.id).toBe(first);
    });

    it('مدينة عندها مضلّع ونقطة جوّه: بترجع النطاق صاحب المضلّع', async () => {
      const inside = await insertZone(cityId, 'مرسوم', { boundaryWkt: squareAround(31.23, 30.05, 0.05) });
      expect((await service.findZoneForPoint(cityId, 30.05, 31.23))?.id).toBe(inside);
    });

    it('**القرار الحاسم**: مدينة عندها مضلّع ونقطة برّه = رفض صريح، مش fallback', async () => {
      await insertZone(cityId, 'بلا-مضلّع'); // موجود ونشط، ومع ذلك مايرجعش
      await insertZone(cityId, 'مرسوم', { boundaryWkt: squareAround(31.23, 30.05, 0.01) });

      expect(await service.findZoneForPoint(cityId, 30.5, 31.9)).toBeNull();
    });

    it('نطاق معطّل مضلّعه بيحتوي النقطة مايترجعش', async () => {
      await insertZone(cityId, 'معطّل', { boundaryWkt: squareAround(31.23, 30.05, 0.05), isActive: false });
      // المدينة كده مالهاش أي مضلّع **نشط**، فالسلوك بيرجع fallback — ومفيش نطاق نشط تاني.
      expect(await service.findZoneForPoint(cityId, 30.05, 31.23)).toBeNull();
    });

    it('نطاق محذوف soft-delete مايترجعش حتى لو مضلّعه بيحتوي النقطة', async () => {
      await insertZone(cityId, 'محذوف', { boundaryWkt: squareAround(31.23, 30.05, 0.05), deleted: true });
      expect(await service.findZoneForPoint(cityId, 30.05, 31.23)).toBeNull();
    });

    it('مضلّع مدينة تانية مابيأثّرش على البحث', async () => {
      await insertZone(otherCityId, 'جار', { boundaryWkt: squareAround(31.23, 30.05, 0.05) });
      const fallback = await insertZone(cityId, 'محلي');
      // مدينتنا لسه مالهاش أي مضلّع → fallback، مش نطاق المدينة التانية.
      expect((await service.findZoneForPoint(cityId, 30.05, 31.23))?.id).toBe(fallback);
    });

    it('نقطة على حدود مضلّعين: بترجع الأقدم (ترتيب حتمي)', async () => {
      const older = await insertZone(cityId, 'قديم', { boundaryWkt: squareAround(31.23, 30.05, 0.1) });
      await insertZone(cityId, 'أحدث', { boundaryWkt: squareAround(31.23, 30.05, 0.1) });
      expect((await service.findZoneForPoint(cityId, 30.05, 31.23))?.id).toBe(older);
    });
  });

  describe('isAreaLaunchedInCity — البَقّة اللي الدالة دي اتكتبت عشانها', () => {
    it('منطقة تابعة لمدينة تانية بترفض حتى لو مُطلقة ونشطة', async () => {
      const areaInOtherCity = await insertArea(otherCityId, 'جار');
      expect(await service.isAreaLaunched(areaInOtherCity)).toBe(true);
      // نفس المنطقة بالظبط، بس مع `city_id` غلط → مرفوضة.
      expect(await service.isAreaLaunchedInCity(areaInOtherCity, cityId)).toBe(false);
    });

    it('منطقة تابعة للمدينة الصح ومُطلقة: مقبولة', async () => {
      const area = await insertArea(cityId, 'صح');
      expect(await service.isAreaLaunchedInCity(area, cityId)).toBe(true);
    });

    it('منطقة مش مُطلقة أو معطّلة: مرفوضة حتى في مدينتها', async () => {
      const notLaunched = await insertArea(cityId, 'مش-مطلقة', { launched: false });
      const inactive = await insertArea(cityId, 'معطّلة', { active: false });
      expect(await service.isAreaLaunchedInCity(notLaunched, cityId)).toBe(false);
      expect(await service.isAreaLaunchedInCity(inactive, cityId)).toBe(false);
    });

    it('معرّف منطقة مش موجود بيرجع false مش استثناء', async () => {
      expect(await service.isAreaLaunched('01a00000-0000-7000-8000-0000000000ff')).toBe(false);
    });
  });

  describe('findLaunchedAreas / findServiceZoneOrThrow', () => {
    it('بترجع المُطلقة بس مرتّبة بالاسم العربي', async () => {
      await insertArea(cityId, 'ي-آخر');
      await insertArea(cityId, 'أ-أول');
      await insertArea(cityId, 'مخفية', { launched: false });

      const areas = await service.findLaunchedAreas(cityId);
      const mine = areas.filter((a) => a.nameAr.includes(runId));
      expect(mine).toHaveLength(2);
      expect(mine.map((a) => a.nameAr)).toEqual([...mine.map((a) => a.nameAr)].sort((x, y) => x.localeCompare(y, 'ar')));
    });

    it('نطاق مش موجود بيرمي خطأ واضح مش null صامت', async () => {
      await expect(service.findServiceZoneOrThrow('01a00000-0000-7000-8000-0000000000fe')).rejects.toBeInstanceOf(
        ApiException,
      );
    });
  });
});
