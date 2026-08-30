import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { technicianCityCoverageCondition } from './technician-eligibility.sql';

describe('حد مدينة المساعد', () => {
  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    cityA: '',
    cityB: '',
    zoneA1: '',
    zoneA2: '',
    zoneB: '',
    user: '',
    profile: '',
  };
  const q = <T = any>(sql: string, params?: unknown[]): Promise<T[]> => dataSource.query(sql, params);

  async function covers(requestedZoneId: string): Promise<boolean> {
    const condition = technicianCityCoverageCondition({
      technicianIdExpr: '$1',
      requestedServiceZoneIdExpr: '$2',
    });
    const [row] = await q<{ covered: boolean }>(`SELECT (${condition}) AS covered`, [ids.profile, requestedZoneId]);
    return row.covered;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    const [country] = await q<{ id: string }>(`SELECT id FROM countries ORDER BY created_at LIMIT 1`);
    const [cityA] = await q<{ id: string }>(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة أ ${runId}`, `City A ${runId}`, `assistant-city-a-${runId}`],
    );
    const [cityB] = await q<{ id: string }>(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ب ${runId}`, `City B ${runId}`, `assistant-city-b-${runId}`],
    );
    ids.cityA = cityA.id;
    ids.cityB = cityB.id;

    const createZone = async (cityId: string, suffix: string) =>
      (
        await q<{ id: string }>(
          `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
          [cityId, `نطاق ${suffix} ${runId}`, `Zone ${suffix} ${runId}`],
        )
      )[0].id;
    ids.zoneA1 = await createZone(ids.cityA, 'A1');
    ids.zoneA2 = await createZone(ids.cityA, 'A2');
    ids.zoneB = await createZone(ids.cityB, 'B');

    const [user] = await q<{ id: string }>(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2055${runId}`.slice(0, 15), `مساعد مدينة ${runId}`],
    );
    ids.user = user.id;
    const [profile] = await q<{ id: string }>(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,technician_kind,current_level)
       VALUES ($1,$2,'x','approved','assistant','new') RETURNING id`,
      [ids.user, `CITY${runId}`.slice(0, 20)],
    );
    ids.profile = profile.id;
    await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [
      ids.profile,
      ids.zoneA1,
    ]);
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.profile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.profile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1::uuid[])`, [[ids.zoneA1, ids.zoneA2, ids.zoneB]]);
      await q(`DELETE FROM cities WHERE id = ANY($1::uuid[])`, [[ids.cityA, ids.cityB]]);
    } finally {
      await dataSource.destroy();
    }
  }, 20000);

  it('تعيين نطاق واحد يفتح كل نطاقات نفس المدينة', async () => {
    expect(await covers(ids.zoneA1)).toBe(true);
    expect(await covers(ids.zoneA2)).toBe(true);
  });

  it('لا يسمح بمدينة أخرى حتى لو المسافة الجغرافية قريبة', async () => {
    expect(await covers(ids.zoneB)).toBe(false);
  });

  it('تعطيل نطاق المساعد يقفل تغطية المدينة', async () => {
    await q(`UPDATE technician_zones SET is_active = false WHERE technician_id = $1`, [ids.profile]);
    try {
      expect(await covers(ids.zoneA1)).toBe(false);
      expect(await covers(ids.zoneA2)).toBe(false);
    } finally {
      await q(`UPDATE technician_zones SET is_active = true WHERE technician_id = $1`, [ids.profile]);
    }
  });
});
