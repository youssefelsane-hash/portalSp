import 'reflect-metadata';
import * as path from 'path';
import { globSync } from 'glob';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../modules/audit/entities/audit-log.entity';
import { AuditLogService } from '../../modules/audit/audit-log.service';
import { User } from '../../modules/auth/entities/user.entity';
import { Permission } from '../../modules/admin/entities/permission.entity';
import { Role } from '../../modules/admin/entities/role.entity';
import { UserRole } from '../../modules/admin/entities/user-role.entity';
import { PermissionsService } from '../../modules/admin/permissions.service';
import { SecurityEventsService } from '../../modules/security/security-events.service';
import { AdminRouteRbacReport, formatUndeclared, scanAdminRoutes } from './admin-route-rbac.scanner';

/**
 * تدقيق S-1 — «٩٢ مسار أدمن بلا أي صلاحية».
 *
 * السبب الجذري مش إن حد نسي ديكوريتور ٩٢ مرة؛ السبب إن **الغياب ماكانش ليه أي أثر ظاهر**:
 * `PermissionsGuard` بيعدّي المسار اللي مالوش `@RequirePermission`، وكل موظف `user_type='admin'`،
 * فالمسار الجديد بيطلع مفتوح للكل ومحدش يعرف. الاختبار ده بيخلّي الغياب مستحيل يعدّي بصمت.
 *
 * `scanAdminRoutes` هي نفس الدالة اللي `AdminRouteRbacValidator` بيستعملها وقت إقلاع التطبيق —
 * الفرق إن هنا بنجيب الـcontrollers بالـimport المباشر بدل `DiscoveryService`، عشان مانقوّمش
 * التطبيق كله بطوابيره جوّه jest.
 */
describe('تدقيق S-1 — كل مسار أدمن معلَن صلاحيته', () => {
  let report: AdminRouteRbacReport;

  beforeAll(async () => {
    const root = path.resolve(__dirname, '../..');
    const controllers: (new (...args: never[]) => unknown)[] = [];
    for (const file of globSync('**/*.controller.ts', { cwd: root })) {
      const mod = (await import(path.join(root, file))) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (typeof exported === 'function') controllers.push(exported as never);
      }
    }
    report = scanAdminRoutes(controllers);
  });

  it('مفيش مسار مقصور على الأدمن بلا @RequirePermission ولا @AnyAdmin', () => {
    if (report.undeclared.length > 0) throw new Error(formatUndeclared(report.undeclared));
    expect(report.undeclared).toHaveLength(0);
  });

  it('الفحص بيشوف عدد معقول من المسارات (مايبقاش عدّى لأنه مالقاش حاجة)', () => {
    // لو الـglob أو الـmetadata اتكسروا، `undeclared` هتبقى فاضية بالغلط والاختبار فوق يعدّي.
    expect(report.declared.length).toBeGreaterThan(300);
  });

  /**
   * `@AnyAdmin` هو الباب الوحيد المتبقّي لمسار أدمن بلا صلاحية — فمقفول بقايمة صريحة هنا.
   * إضافة مسار جديد للقايمة دي **لازم** تعدّل الاختبار ده، يعني قرار مكتوب مش سهو.
   */
  it('مسارات @AnyAdmin محصورة في القراءة/الكتابة الذاتية بس', () => {
    const open = report.declared
      .filter((d) => d.permission === null)
      .map((d) => `${d.controller}.${d.handler}`)
      .sort();
    expect(open).toEqual(['AdminRolesController.getMyPermissions', 'AdminWorkforceController.heartbeat']);
  });

  it('كل @AnyAdmin معاه سبب مكتوب مش نص فاضي', () => {
    for (const d of report.declared.filter((x) => x.permission === null)) {
      expect((d.anyAdminReason ?? '').trim().length).toBeGreaterThan(10);
    }
  });

  it('الفئات الحسّاسة مربوطة بالصلاحية الصح مش بصلاحية عامة', () => {
    const permissionOf = (controller: string, handler: string): string | null | undefined =>
      report.declared.find((d) => d.controller === controller && d.handler === handler)?.permission;

    // كشوف أرباح الفني: نطاق مالي منفصل عن قراءة ملف الفني العادي — ده كان جوهر بلاغ التدقيق.
    expect(permissionOf('AdminTechniciansController', 'earningsStatement')).toBe('technicians.finance.view');
    expect(permissionOf('AdminTechniciansController', 'earningsReconciliation')).toBe('technicians.finance.view');
    expect(permissionOf('AdminTechniciansController', 'earningsMonths')).toBe('technicians.finance.view');
    expect(permissionOf('AdminTechniciansController', 'getDetail')).toBe('technicians.view');

    // بيانات العملاء الشخصية (تليفون/عناوين/تاريخ الطلبات).
    for (const handler of ['list', 'getDetail', 'get360', 'listOrderHistory', 'listAddresses']) {
      expect(permissionOf('AdminCustomersController', handler)).toBe('customers.view');
    }

    // الكتابتين اللي التدقيق سمّاهما «سهو شبه أكيد»: كتابة بلا أي صلاحية.
    expect(permissionOf('AdminOrdersController', 'addInternalNote')).toBe('orders.notes.add');
    expect(permissionOf('AdminTechnicianInternalNotesController', 'add')).toBe('technicians.notes.add');

    // بَقّة الانقفال الصامت اللي فحص الكتالوج لقاها: الاتنين دول كانوا بيطلبوا
    // `technicians.manage` — اسم مش موجود في الكتالوج، يعني مقفولين على الكل للأبد.
    expect(permissionOf('AdminTechniciansController', 'setNationalId')).toBe('technicians.national_id.manage');
    expect(permissionOf('AdminTechniciansController', 'revealNationalId')).toBe('technicians.national_id.view');
  });

  it('كل اسم صلاحية مذكور في المسارات موجود فعلاً في كتالوج permissions', async () => {
    // نفس فحص `AdminRouteRbacValidator.assertPermissionsExistInCatalog` — اسم غلط بيفشل **مقفول**
    // (محدش يقدر ينفّذ العملية أبدًا، ولا حتى بدور كامل)، وده اللي حصل فعلاً مع الرقم القومي فوق.
    const referenced = Array.from(
      new Set(report.declared.map((d) => d.permission).filter((p): p is string => p !== null)),
    );
    const dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Permission],
    });
    await dataSource.initialize();
    try {
      const rows = await dataSource.query<{ name: string }[]>(
        `SELECT name FROM permissions WHERE name = ANY($1::text[])`,
        [referenced],
      );
      const known = new Set(rows.map((r) => r.name));
      expect(referenced.filter((n) => !known.has(n))).toEqual([]);
    } finally {
      await dataSource.destroy();
    }
  });
});

describe('تدقيق S-1 — كتالوج الصلاحيات والتوزيع على الأدوار (حي)', () => {
  let dataSource: DataSource;
  let service: PermissionsService;

  const runId = Date.now().toString(36);
  const roleUserIds: Record<string, string> = {};
  let narrowRoleId = '';
  let narrowUserId = '';

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
    let counter = 0;
    const mkAdminWithRole = async (roleName: string): Promise<string> => {
      counter += 1;
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
        [`+20s1${counter}${runId}`.slice(0, 15), `أدمن تدقيق S1 ${roleName} ${runId}`],
      );
      const [role] = await q(`SELECT id FROM roles WHERE name = $1`, [roleName]);
      await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [user.id, role.id]);
      return user.id as string;
    };

    for (const roleName of ['ops_manager', 'finance', 'support_agent', 'recruiter']) {
      roleUserIds[roleName] = await mkAdminWithRole(roleName);
    }

    // السيناريو بالحرف من تقرير التدقيق: موظف عنده صلاحية واحدة تشغيلية بس.
    const [narrowRole] = await q(
      `INSERT INTO roles (name, display_name) VALUES ($1,$2) RETURNING id`,
      [`s1_tickets_only_${runId}`, `دعم تذاكر فقط ${runId}`],
    );
    narrowRoleId = narrowRole.id as string;
    await q(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE name = 'support_tickets.manage'`,
      [narrowRoleId],
    );
    counter += 1;
    const [narrowUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+20s1${counter}${runId}`.slice(0, 15), `أدمن تدقيق S1 ضيّق ${runId}`],
    );
    narrowUserId = narrowUser.id as string;
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [narrowUserId, narrowRoleId]);
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const userIds = [...Object.values(roleUserIds), narrowUserId];
    await q(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [userIds]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await q(`DELETE FROM role_permissions WHERE role_id = $1`, [narrowRoleId]);
    await q(`DELETE FROM roles WHERE id = $1`, [narrowRoleId]);
    await dataSource.destroy();
  });

  it('الصلاحيات الجديدة كلها موجودة في الكتالوج بالـresource/action الصح', async () => {
    const expected: [string, string, string][] = [
      ['catalog.view', 'catalog', 'view'],
      ['customers.view', 'customers', 'view'],
      ['orders.view', 'orders', 'view'],
      ['orders.notes.add', 'orders', 'notes_add'],
      ['technicians.view', 'technicians', 'view'],
      ['technicians.finance.view', 'technicians', 'finance_view'],
      ['technicians.notes.view', 'technicians', 'notes_view'],
      ['technicians.notes.add', 'technicians', 'notes_add'],
      ['employees.view', 'employees', 'view'],
      ['roles.view', 'roles', 'view'],
      ['operations.view', 'operations', 'view'],
    ];
    const rows = await dataSource.query<{ name: string; resource: string; action: string }[]>(
      `SELECT name, resource, action FROM permissions WHERE name = ANY($1)`,
      [expected.map(([name]) => name)],
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const [name, resource, action] of expected) {
      expect(byName.get(name)).toEqual({ name, resource, action });
    }
  });

  it('البَقّة الأصلية اتقفلت: موظف عنده support_tickets.manage بس مايقدرش يقرا أرباح فني ولا بيانات عميل', async () => {
    expect(await service.hasPermission(narrowUserId, 'technicians.finance.view')).toBe(false);
    expect(await service.hasPermission(narrowUserId, 'customers.view')).toBe(false);
    expect(await service.hasPermission(narrowUserId, 'technicians.view')).toBe(false);
    expect(await service.hasPermission(narrowUserId, 'employees.view')).toBe(false);
    // ولسه بيشوف اللي شغله محتاجه فعلاً — التضييق مش تعطيل.
    expect(await service.hasPermission(narrowUserId, 'support_tickets.view')).toBe(true);
  });

  it('قاعدة الاشتقاق: دور جديد بـsupport_tickets.manage بس بياخد support_tickets.view ضمنيًا', async () => {
    // الفخ اللي القاعدة دي موجودة عشانه: لو المنح كان صفوف ثابتة في migration، الدور اللي
    // المشغّل بينشئه من الواجهة بعد كده كان هيبقى «بيدير التذاكر» ومايقدرش يفتح شاشتها.
    expect(await service.hasPermission(narrowUserId, 'support_tickets.view')).toBe(true);
    // ومابيتخطّاش المورد: التذاكر مالهاش علاقة بالطلبات ولا العملاء.
    expect(await service.hasPermission(narrowUserId, 'orders.view')).toBe(false);
  });

  it('الاشتقاق مابيسربش النطاقات الأضيق على نفس المورد', async () => {
    // مسؤول التوظيف عنده `technicians.approve` → بياخد `technicians.view` ضمنيًا (action = view)،
    // بس **مش** `technicians.finance.view` (action = finance_view) — الفرق ده هو اللي بيمنع
    // كشف أرباح الفنيين من إنه يتسرّب بالوراثة لكل حد بيلمس ملف الفني.
    expect(await service.hasPermission(roleUserIds.recruiter, 'technicians.view')).toBe(true);
    expect(await service.hasPermission(roleUserIds.recruiter, 'technicians.finance.view')).toBe(false);
  });

  it('كشف أرباح الفنيين للمالية بس — مش للعمليات ولا التوظيف ولا الدعم', async () => {
    expect(await service.hasPermission(roleUserIds.finance, 'technicians.finance.view')).toBe(true);
    for (const roleName of ['ops_manager', 'support_agent', 'recruiter']) {
      expect(await service.hasPermission(roleUserIds[roleName], 'technicians.finance.view')).toBe(false);
    }
  });

  it('بيانات الموظفين وإدارة الأدوار مقفولة على الأدوار التشغيلية', async () => {
    for (const roleName of ['ops_manager', 'finance', 'support_agent', 'recruiter']) {
      expect(await service.hasPermission(roleUserIds[roleName], 'employees.view')).toBe(false);
      expect(await service.hasPermission(roleUserIds[roleName], 'roles.view')).toBe(false);
    }
  });

  it('مفيش دور خسر قدرة كان بيستعملها — الشاشات اللي كانت شغّالة لسه شغّالة', async () => {
    // مدير العمليات: مركز العمليات + الطلبات + الكتالوج + الفنيين.
    for (const perm of ['operations.view', 'orders.view', 'catalog.view', 'geo.view', 'technicians.view', 'customers.view']) {
      expect(await service.hasPermission(roleUserIds.ops_manager, perm)).toBe(true);
    }
    // الدعم: بينشئ طلب نيابة عن عميل — محتاج الكتالوج والمناطق والعميل والفنيين.
    for (const perm of ['orders.view', 'customers.view', 'catalog.view', 'geo.view', 'technicians.view']) {
      expect(await service.hasPermission(roleUserIds.support_agent, perm)).toBe(true);
    }
    // التوظيف: ملف الفني وشركاته وسجل الأكاديمية وملاحظاته.
    for (const perm of ['technicians.view', 'technician_companies.view', 'academy.view', 'technicians.notes.view']) {
      expect(await service.hasPermission(roleUserIds.recruiter, perm)).toBe(true);
    }
  });
});
