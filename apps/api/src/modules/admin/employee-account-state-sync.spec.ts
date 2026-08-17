import { DataSource } from 'typeorm';
import { AdminEmployeesService } from './admin-employees.service';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';

describe('Employee profile/account state synchronization (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: AdminEmployeesService;
  const runId = Date.now().toString(36);
  const ids = { actor: '', target: '', profile: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, EmployeeProfile, RefreshToken],
    });
    await dataSource.initialize();
    const users = await dataSource.query<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES
         ($1,$2,'admin'), ($3,$4,'admin') RETURNING id`,
      [
        `+2014${runId}a`.slice(0, 15), `State actor ${runId}`,
        `+2014${runId}t`.slice(0, 15), `State target ${runId}`,
      ],
    );
    [ids.actor, ids.target] = users.map((user) => user.id);
    const [profile] = await dataSource.query(
      `INSERT INTO employee_profiles (user_id, employee_code, department, created_by_user_id)
       VALUES ($1,$2,'support',$3) RETURNING id`,
      [ids.target, `TEST-STATE-${runId}`.slice(0, 24), ids.actor],
    );
    ids.profile = profile.id;
    await dataSource.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,now() + interval '1 day')`,
      [ids.target, `employee-state-${runId}`],
    );

    service = new AdminEmployeesService(
      dataSource,
      dataSource.getRepository(User),
      dataSource.getRepository(EmployeeProfile),
      dataSource.getRepository(RefreshToken),
      { record: jest.fn() } as never,
      { isLastSuperAdmin: jest.fn().mockResolvedValue(false) } as never,
    );
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [ids.target]);
    await dataSource.query(`DELETE FROM employee_profiles WHERE id = $1`, [ids.profile]);
    await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.actor, ids.target]]);
    await dataSource.destroy();
  });

  it('deactivates profile and login identity atomically and revokes refresh sessions', async () => {
    await service.update(ids.actor, ids.target, { is_active: false });

    const user = await dataSource.getRepository(User).findOneByOrFail({ id: ids.target });
    const profile = await dataSource.getRepository(EmployeeProfile).findOneByOrFail({ id: ids.profile });
    const token = await dataSource.getRepository(RefreshToken).findOneByOrFail({ userId: ids.target });
    expect(user.isActive).toBe(false);
    expect(profile.isActive).toBe(false);
    expect(token.isRevoked).toBe(true);
    expect(token.revokedReason).toBe('employee_deactivated');
  });

  it('reactivates both identity layers without reviving old sessions', async () => {
    await service.update(ids.actor, ids.target, { is_active: true });

    expect((await dataSource.getRepository(User).findOneByOrFail({ id: ids.target })).isActive).toBe(true);
    expect((await dataSource.getRepository(EmployeeProfile).findOneByOrFail({ id: ids.profile })).isActive).toBe(true);
    expect((await dataSource.getRepository(RefreshToken).findOneByOrFail({ userId: ids.target })).isRevoked).toBe(true);
  });
});
