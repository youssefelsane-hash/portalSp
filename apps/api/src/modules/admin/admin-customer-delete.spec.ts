import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { AdminCustomersService } from './admin-customers.service';

// اختبار حي ضد Postgres حقيقي — §24: كانت فجوة موثّقة صراحة (admin/README.md) — DELETE
// /admin/customers/:userId مش موجود أصلاً رغم إن نفس الأداة اتبنت للموظفين. اتقفلت بنفس نمط
// AdminEmployeesService.delete() بالحرف (إلغاء توكنات → is_active=false → softDelete)، بلا سحب
// أدوار RBAC (العملاء مالهمش UserRole أصلاً).
describe('AdminCustomersService.delete() — soft-delete حساب عميل (docs/08 §24)', () => {
  let dataSource: DataSource;
  let service: AdminCustomersService;
  const runId = Date.now().toString(36);
  const ids = { user: '', profile: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, CustomerProfile, RefreshToken],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2019${runId}`.slice(0, 15),
      `عميل اختبار حذف ${runId}`,
    ]);
    ids.user = user.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.user]);
    ids.profile = profile.id;
    await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '30 day')`,
      [ids.user, `hash-${runId}`],
    );

    service = new AdminCustomersService(
      dataSource,
      dataSource.getRepository(User),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(RefreshToken),
      { record: async () => undefined } as unknown as AuditLogService,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM refresh_tokens WHERE user_id = $1`, [ids.user]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await dataSource.destroy();
  });

  it('بيلغي التوكنات النشطة، يعطّل الحساب، ويعمل soft-delete على User وCustomerProfile', async () => {
    await service.delete('00000000-0000-0000-0000-000000000001', ids.user);

    const [userRow] = await dataSource.query(`SELECT is_active, deleted_at FROM users WHERE id = $1`, [ids.user]);
    expect(userRow.is_active).toBe(false);
    expect(userRow.deleted_at).not.toBeNull();

    const [profileRow] = await dataSource.query(`SELECT deleted_at FROM customer_profiles WHERE id = $1`, [ids.profile]);
    expect(profileRow.deleted_at).not.toBeNull();

    const [tokenRow] = await dataSource.query(`SELECT is_revoked, revoked_reason FROM refresh_tokens WHERE user_id = $1`, [ids.user]);
    expect(tokenRow.is_revoked).toBe(true);
    expect(tokenRow.revoked_reason).toBe('admin_delete');
  });

  it('بعد الحذف، getDetail()/list() ماعادوش يلاقوا العميل (فلتر deleted_at IS NULL التلقائي)', async () => {
    await expect(service.getDetail(ids.user)).rejects.toThrow();
  });
});
