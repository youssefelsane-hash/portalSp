import { DataSource } from 'typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { SecurityEventsService } from '../security/security-events.service';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

// اختبار حي ضد Postgres حقيقي (نفس فلسفة المشروع) — بيثبت إصلاح بَقّة تصعيد الصلاحيات الحقيقية
// (مراجعة أمان شاملة 2026-08-13، بند P0-1 في docs/12): assignRole()/cloneRole() كانوا بيسمحوا
// لأدمن عنده roles.manage بس إنه يعيّن/ينسخ دور فيه صلاحيات هو نفسه ماعندوش — بما فيها super_admin
// نفسه، من غير أي فحص. revokeRole() كانت نفس المشكلة (أي أدمن يقدر يسحب super_admin من حساب تاني).
describe('PermissionsService — منع تصعيد الصلاحيات في assignRole/revokeRole/cloneRole (regression)', () => {
  let dataSource: DataSource;
  let service: PermissionsService;

  const runId = Date.now().toString(36);
  const ids = {
    permA: '',
    permB: '',
    roleLow: '',
    roleHigh: '',
    roleUnrestricted: '',
    roleSuperTest: '',
    actorLow: '',
    actorUnrestricted: '',
    target: '',
    realSuperAdminRoleId: '',
    superAdminActor: '',
    targetSuperAdmin: '',
    nonSuperAdminActor: '',
  };

  beforeAll(async () => {
    // لازم entities هنا (خلاف matching.service.spec.ts) — PermissionsService بتستخدم Repository<T>
    // حقيقية (this.users.findOne/this.roles.findOne إلخ)، مش raw SQL بس، فمحتاجة metadata فعلي.
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

    // العداد لازم يجي فوراً بعد "+20" في رقم الموبايل — العمود varchar(15)، فأي جزء بعد الرقم
    // بيتقطع، ولو الفوارق بين اللابلز كانت في الآخر (مش الأول) ممكن تتقطع فيحصل تصادم (اتلقط
    // ده فعليًا وقت كتابة الاختبار: "actor-low"/"actor-unres" الاتنين بيبدأوا بـ"ac").
    let phoneCounter = 0;
    const mkAdmin = async (label: string) => {
      phoneCounter += 1;
      const phone = `+20${String(phoneCounter).padStart(3, '0')}${runId}`.slice(0, 15);
      const [row] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
        [phone, `أدمن اختبار ${label} ${runId}`],
      );
      return row.id as string;
    };

    const [permA] = await q(
      `INSERT INTO permissions (name, resource, action) VALUES ($1,'test_resource',$2) RETURNING id`,
      [`test.alpha.${runId}`, `alpha_${runId}`],
    );
    ids.permA = permA.id;
    const [permB] = await q(
      `INSERT INTO permissions (name, resource, action) VALUES ($1,'test_resource',$2) RETURNING id`,
      [`test.beta.${runId}`, `beta_${runId}`],
    );
    ids.permB = permB.id;

    const [roleLow] = await q(
      `INSERT INTO roles (name, display_name) VALUES ($1,$2) RETURNING id`,
      [`role_low_${runId}`, 'دور منخفض (اختبار)'],
    );
    ids.roleLow = roleLow.id;
    await q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [ids.roleLow, ids.permA]);

    const [roleHigh] = await q(
      `INSERT INTO roles (name, display_name) VALUES ($1,$2) RETURNING id`,
      [`role_high_${runId}`, 'دور أعلى (اختبار)'],
    );
    ids.roleHigh = roleHigh.id;
    await q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2), ($1,$3)`, [
      ids.roleHigh,
      ids.permA,
      ids.permB,
    ]);

    const [roleUnrestricted] = await q(
      `INSERT INTO roles (name, display_name) VALUES ($1,$2) RETURNING id`,
      [`role_unrestricted_${runId}`, 'دور roles.grant_unrestricted (اختبار)'],
    );
    ids.roleUnrestricted = roleUnrestricted.id;
    const [grantUnrestrictedPerm] = await q(`SELECT id FROM permissions WHERE name = 'roles.grant_unrestricted'`);
    await q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [
      ids.roleUnrestricted,
      grantUnrestrictedPerm.id,
    ]);

    // دور is_super_admin=true منفصل عن الدور الحقيقي 'super_admin' المزروع — عشان نختبر
    // assignRole()/cloneRole() (اللي بقوا بيفحصوا role.isSuperAdmin عمومًا) من غير ما نلمس
    // بيانات الدور الحقيقي المشترك مع باقي الاختبارات/النظام.
    const [roleSuperTest] = await q(
      `INSERT INTO roles (name, display_name, is_super_admin) VALUES ($1,$2,true) RETURNING id`,
      [`role_super_test_${runId}`, 'دور super_admin تجريبي (اختبار)'],
    );
    ids.roleSuperTest = roleSuperTest.id;

    ids.actorLow = await mkAdmin('actor-low');
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [ids.actorLow, ids.roleLow]);

    ids.actorUnrestricted = await mkAdmin('actor-unres');
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [ids.actorUnrestricted, ids.roleUnrestricted]);

    ids.target = await mkAdmin('target');

    // revokeRole() لسه بتفحص روح الدور الحقيقي 'super_admin' بالاسم (SUPER_ADMIN_ROLE_NAME) —
    // محتاجين نختبرها ضد نفس الصف الحقيقي، مش دور تجريبي. عشان نتجنب أي تعارض مع "آخر super_admin"،
    // بنضيف super admin تاني وthird مؤقتين، ونمسحهم في afterAll.
    const [realSuperAdminRole] = await q(`SELECT id FROM roles WHERE name = 'super_admin'`);
    ids.realSuperAdminRoleId = realSuperAdminRole.id;

    ids.superAdminActor = await mkAdmin('super-actor');
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [ids.superAdminActor, ids.realSuperAdminRoleId]);

    ids.targetSuperAdmin = await mkAdmin('super-target');
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [ids.targetSuperAdmin, ids.realSuperAdminRoleId]);

    ids.nonSuperAdminActor = await mkAdmin('non-super-actor');
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [
      [ids.actorLow, ids.actorUnrestricted, ids.target, ids.superAdminActor, ids.targetSuperAdmin, ids.nonSuperAdminActor],
    ]);
    const testUserIds = [
      ids.actorLow,
      ids.actorUnrestricted,
      ids.target,
      ids.superAdminActor,
      ids.targetSuperAdmin,
      ids.nonSuperAdminActor,
    ];
    // audit_logs بتشير لمستخدمينا سواء actor_user_id (كل عملية سجّلناها) أو entity_id (الطلبات
    // اللي كان الهدف فيها مستخدم زي role.assigned/role.revoked) — لازم الاتنين يتنضّفوا قبل users.
    await q(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1) OR entity_id = ANY($1)`, [testUserIds]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [testUserIds]);
    await q(`DELETE FROM roles WHERE id = ANY($1)`, [[ids.roleLow, ids.roleHigh, ids.roleUnrestricted, ids.roleSuperTest]]);
    await q(`DELETE FROM permissions WHERE id = ANY($1)`, [[ids.permA, ids.permB]]);
    await dataSource.destroy();
  });

  it('assignRole: الفاعل من غير كل صلاحيات الدور يترفض (AUTH_001/403)', async () => {
    await expect(service.assignRole(ids.actorLow, ids.target, `role_high_${runId}`)).rejects.toMatchObject({
      code: 'AUTH_001',
    });
    const roles = await service.listUserRoles(ids.target);
    expect(roles.some((r) => r.role_name === `role_high_${runId}`)).toBe(false);
  });

  it('assignRole: الفاعل عنده كل صلاحيات الدور بالظبط ينجح (السلوك الأصلي محفوظ)', async () => {
    await service.assignRole(ids.actorLow, ids.target, `role_low_${runId}`);
    const roles = await service.listUserRoles(ids.target);
    expect(roles.some((r) => r.role_name === `role_low_${runId}`)).toBe(true);
    await service.revokeRole(ids.actorLow, ids.target, `role_low_${runId}`);
  });

  it('assignRole: roles.grant_unrestricted بيتخطى فحص الصلاحيات العادي', async () => {
    await service.assignRole(ids.actorUnrestricted, ids.target, `role_high_${runId}`);
    const roles = await service.listUserRoles(ids.target);
    expect(roles.some((r) => r.role_name === `role_high_${runId}`)).toBe(true);
    await service.revokeRole(ids.actorUnrestricted, ids.target, `role_high_${runId}`);
  });

  it('assignRole: دور is_super_admin مايتعيّنش حتى من فاعل عنده roles.grant_unrestricted', async () => {
    await expect(service.assignRole(ids.actorUnrestricted, ids.target, `role_super_test_${runId}`)).rejects.toMatchObject({
      code: 'AUTH_001',
    });
  });

  it('assignRole: super_admin حقيقي يقدر يعيّن دور is_super_admin', async () => {
    await service.assignRole(ids.superAdminActor, ids.target, `role_super_test_${runId}`);
    const roles = await service.listUserRoles(ids.target);
    expect(roles.some((r) => r.role_name === `role_super_test_${runId}`)).toBe(true);
    await service.revokeRole(ids.superAdminActor, ids.target, `role_super_test_${runId}`);
  });

  it('revokeRole: أدمن مش super_admin مايقدرش يسحب دور super_admin من حساب تاني', async () => {
    await expect(service.revokeRole(ids.nonSuperAdminActor, ids.targetSuperAdmin, 'super_admin')).rejects.toMatchObject({
      code: 'AUTH_001',
    });
    const roles = await service.listUserRoles(ids.targetSuperAdmin);
    expect(roles.some((r) => r.role_name === 'super_admin')).toBe(true);
  });

  it('revokeRole: super_admin حقيقي يقدر يسحب دور super_admin من حساب تاني', async () => {
    await service.revokeRole(ids.superAdminActor, ids.targetSuperAdmin, 'super_admin');
    const roles = await service.listUserRoles(ids.targetSuperAdmin);
    expect(roles.some((r) => r.role_name === 'super_admin')).toBe(false);
    // نرجّع الحالة الأصلية عشان لو الاختبار اتعاد تشغيله والتنظيف يفضل متوقّع.
    await service.assignRole(ids.superAdminActor, ids.targetSuperAdmin, 'super_admin');
  });

  it('cloneRole: الفاعل من غير كل صلاحيات المصدر يترفض', async () => {
    await expect(
      service.cloneRole(ids.actorLow, ids.roleHigh, { name: `role_clone_fail_${runId}`, display_name: 'نسخة مرفوضة' }),
    ).rejects.toMatchObject({ code: 'AUTH_001' });
  });

  it('cloneRole: roles.grant_unrestricted بيسمح بنسخ دور فيه صلاحيات أكتر من الفاعل', async () => {
    const cloned = await service.cloneRole(ids.actorUnrestricted, ids.roleHigh, {
      name: `role_clone_ok_${runId}`,
      display_name: 'نسخة ناجحة',
    });
    const detail = await service.getRoleDetail(cloned.id);
    expect(detail.permission_names).toEqual(expect.arrayContaining([`test.alpha.${runId}`, `test.beta.${runId}`]));
    await dataSource.query(`DELETE FROM roles WHERE id = $1`, [cloned.id]);
  });

  it('cloneRole: دور is_super_admin مايتنسخش حتى من فاعل عنده roles.grant_unrestricted', async () => {
    await expect(
      service.cloneRole(ids.actorUnrestricted, ids.roleSuperTest, {
        name: `role_clone_super_fail_${runId}`,
        display_name: 'نسخة سوبر مرفوضة',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_001' });
  });

  it('cloneRole: super_admin حقيقي يقدر ينسخ دور is_super_admin', async () => {
    const cloned = await service.cloneRole(ids.superAdminActor, ids.roleSuperTest, {
      name: `role_clone_super_ok_${runId}`,
      display_name: 'نسخة سوبر ناجحة',
    });
    expect(cloned.name).toBe(`role_clone_super_ok_${runId}`);
    await dataSource.query(`DELETE FROM roles WHERE id = $1`, [cloned.id]);
  });
});
