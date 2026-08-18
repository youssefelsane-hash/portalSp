import { DataSource } from 'typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { SecurityEventsService } from '../security/security-events.service';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح بَقّة P0-2 (مراجعة أمان شاملة 2026-08-13، docs/12):
// AdminReportsController وAdminRecurringOrdersController كانوا محميين بـ@Roles(ADMIN) بس، أي
// حساب أدمن (حتى support_agent بلا أي دور تشغيلي) كان يقدر يشوف الداشبورد/الإيراد/تقارير
// الفنيين والمناطق/القوالب المتكررة. migration 0085 أضافت reports.view/recurring_orders.view
// (ممنوحة لـops_manager/finance بس)، والكنترولرين بقى عليهم @RequirePermission.
describe('reports.view / recurring_orders.view — منح صحيح (regression P0-2)', () => {
  let dataSource: DataSource;
  let service: PermissionsService;

  const runId = Date.now().toString(36);
  let supportAgentUserId = '';
  let opsManagerUserId = '';

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
      { recordDenial: async () => undefined } as unknown as SecurityEventsService,
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
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const userIds = [supportAgentUserId, opsManagerUserId];
    await q(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [userIds]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await dataSource.destroy();
  });

  it('الكتالوج فيه reports.view/recurring_orders.view بالـresource/action الصح', async () => {
    const permissions = await service.listPermissions();
    const reportsView = permissions.find((p) => p.name === 'reports.view');
    const recurringOrdersView = permissions.find((p) => p.name === 'recurring_orders.view');
    expect(reportsView).toMatchObject({ resource: 'reports', action: 'view' });
    expect(recurringOrdersView).toMatchObject({ resource: 'recurring_orders', action: 'view' });
  });

  it('support_agent (بلا دور تشغيلي) ماعندوش reports.view/recurring_orders.view — كان الثغرة', async () => {
    expect(await service.hasPermission(supportAgentUserId, 'reports.view')).toBe(false);
    expect(await service.hasPermission(supportAgentUserId, 'recurring_orders.view')).toBe(false);
  });

  it('ops_manager عنده reports.view/recurring_orders.view زي المتوقع', async () => {
    expect(await service.hasPermission(opsManagerUserId, 'reports.view')).toBe(true);
    expect(await service.hasPermission(opsManagerUserId, 'recurring_orders.view')).toBe(true);
  });
});
