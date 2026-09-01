import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TechnicianKpiCalculationService } from './technician-kpi-calculation.service';

describe('TechnicianKpiCalculationService — PostgreSQL regression', () => {
  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  let userId = '';
  let profileId = '';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2066${runId}`.slice(0, 15), `فني KPI ${runId}`],
    );
    userId = user.id;
    const [profile] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,current_level)
       VALUES ($1,$2,'x','approved','new') RETURNING id`,
      [userId, `KPI${runId}`.slice(0, 20)],
    );
    profileId = profile.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await dataSource.query(`DELETE FROM technician_profiles WHERE id = $1`, [profileId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('ينفّذ استعلام التقييم بحد 3.3 ويرجع مقاييس بدل 500', async () => {
    const calculation = new TechnicianKpiCalculationService(
      dataSource,
      { getNumber: async () => 3.3 } as never,
    );

    await expect(calculation.getRawMetrics(profileId, userId, 2026, 8)).resolves.toMatchObject({
      ratingsCount: 0,
      negativeRatingsCount: 0,
      technicianEarningsCents: 0,
    });
  });
});
