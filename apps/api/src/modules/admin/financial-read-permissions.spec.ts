import { DataSource } from 'typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح بَقّة أمنية حقيقية (docs/08 §19 بند 8):
// GET /admin/payouts, GET /admin/payouts/:id/order-items, GET /admin/wallets/:userId كانوا
// محميين بـ@Roles(ADMIN) بس بلا @RequirePermission خالص — أي حساب أدمن (حتى support_agent بلا
// أي دور تشغيلي) كان يقدر يقرا بيانات صرف/محفظة حساسة. وGET /admin/reports/revenue كانت تحت
// نفس reports.view العامة اللي ops_manager عنده — يعني ops_manager يقدر يشوف إيراد الشركة رغم
// إنه بيانات مالية بحتة. migration 0099 أضافت payouts.view/wallets.view/reports.view_revenue
// (ممنوحة لـfinance بس، super_admin بياخدها bypass) — الكنترولرات بقى عليها @RequirePermission.
describe('payouts.view / wallets.view / reports.view_revenue — منح مالي صحيح (regression)', () => {
  let dataSource: DataSource;
  let service: PermissionsService;

  const runId = Date.now().toString(36);
  let supportAgentUserId = '';
  let opsManagerUserId = '';
  let financeUserId = '';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, Role, Permission, UserRole, AuditLog],
    });
    await dataSource.initialize();

    service = new PermissionsService(
      dataSource,
      dataSource.getRepository(Role),
      dataSource.getRepository(Permission),
      dataSource.getRepository(UserRole),
      dataSource.getRepository(User),
      new AuditLogService(dataSource.getRepository(AuditLog)),
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const mkAdminWithRole = async (roleName: string, phoneCounter: number) => {
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
        [`+20${String(phoneCounter).padStart(3, '0')}${runId}`.slice(0, 15), `أدمن اختبار ${roleName} ${runId}`],
      );
      const [role] = await q(`SELECT id FROM roles WHERE name = $1`, [roleName]);
      await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [user.id, role.id]);
      return user.id as string;
    };

    supportAgentUserId = await mkAdminWithRole('support_agent', 1);
    opsManagerUserId = await mkAdminWithRole('ops_manager', 2);
    financeUserId = await mkAdminWithRole('finance', 3);
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const userIds = [supportAgentUserId, opsManagerUserId, financeUserId];
    await q(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [userIds]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await dataSource.destroy();
  });

  it('الكتالوج فيه الصلاحيات التلاتة بالـresource/action الصح', async () => {
    const permissions = await service.listPermissions();
    expect(permissions.find((p) => p.name === 'payouts.view')).toMatchObject({ resource: 'payouts', action: 'view' });
    expect(permissions.find((p) => p.name === 'wallets.view')).toMatchObject({ resource: 'wallets', action: 'view' });
    expect(permissions.find((p) => p.name === 'reports.view_revenue')).toMatchObject({
      resource: 'reports',
      action: 'view_revenue',
    });
  });

  it('support_agent (بلا دور تشغيلي) ماعندوش أي صلاحية مالية — كانت الثغرة الأوسع', async () => {
    expect(await service.hasPermission(supportAgentUserId, 'payouts.view')).toBe(false);
    expect(await service.hasPermission(supportAgentUserId, 'wallets.view')).toBe(false);
    expect(await service.hasPermission(supportAgentUserId, 'reports.view_revenue')).toBe(false);
  });

  it('ops_manager عنده reports.view العامة بس **مش** reports.view_revenue ولا payouts.view/wallets.view — الثغرة المالية تحديداً', async () => {
    expect(await service.hasPermission(opsManagerUserId, 'reports.view')).toBe(true);
    expect(await service.hasPermission(opsManagerUserId, 'reports.view_revenue')).toBe(false);
    expect(await service.hasPermission(opsManagerUserId, 'payouts.view')).toBe(false);
    expect(await service.hasPermission(opsManagerUserId, 'wallets.view')).toBe(false);
  });

  it('finance عنده الصلاحيات المالية التلاتة زي المتوقع', async () => {
    expect(await service.hasPermission(financeUserId, 'payouts.view')).toBe(true);
    expect(await service.hasPermission(financeUserId, 'wallets.view')).toBe(true);
    expect(await service.hasPermission(financeUserId, 'reports.view_revenue')).toBe(true);
  });
});
