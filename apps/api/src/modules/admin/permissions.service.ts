import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { User, UserType } from '../auth/entities/user.entity';
import { SecurityEventSeverity, SecurityEventType } from '../security/entities/security-event.entity';
import { SecurityEventsService } from '../security/security-events.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';

interface EscalationDenialContext {
  targetUserId?: string | null;
  targetType?: string | null;
  action: string;
  attemptedValue?: Record<string, unknown> | null;
}

export interface RoleAssignment {
  role_id: string;
  role_name: string;
  display_name: string;
  assigned_at: string;
}

export interface RoleDetail {
  role: Role;
  permission_names: string[];
  /** صلاحيات القراءة المشتقّة تلقائيًا (تدقيق S-1) — مش مخزّنة في `role_permissions`. */
  implied_permission_names: string[];
  users: { user_id: string; full_name: string; phone_number: string; assigned_at: string }[];
}

const SUPER_ADMIN_ROLE_NAME = 'super_admin';

// باني الأدوار الديناميكي (ADR-0010) — تمديد نظام RBAC الموجود من 0003_auth.sql، مش استبداله.
@Injectable()
export class PermissionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissionsRepo: Repository<Permission>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auditLog: AuditLogService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  private async isSuperAdminUser(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND r.is_super_admin = true AND r.is_active = true AND r.deleted_at IS NULL
       ) AS exists`,
      [userId],
    );
    return rows[0]?.exists === true;
  }

  private async getRolePermissionNames(roleId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ name: string }[]>(
      `SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
      [roleId],
    );
    return rows.map((r) => r.name);
  }

  /**
   * بَقّة أمنية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، بند P0-1) — منع تصعيد صلاحيات
   * عبر `assignRole()`/`cloneRole()`: `setRolePermissions()` كان الوحيد اللي بيمنع الفاعل من منح
   * صلاحية هو نفسه ماعندوش، لكن نفس القاعدة ماكانتش متطبّقة على تعيين دور جاهز لمستخدم تاني (يقدر
   * ياخد صلاحيات أعلى بكتير من صلاحياته هو، من غير حتى يعدّل أي دور) ولا على نسخ دور (نسخة جديدة
   * بنفس صلاحيات المصدر بالكامل). الدالة دي بتفرض نفس القاعدة في المكانين الجداد: مينفعش تمنح/تنسخ
   * صلاحية إنت نفسك ملكهاش، إلا بـ`roles.grant_unrestricted` (أو `super_admin` اللي بيتخطاها أصلاً
   * عن طريق `getUserPermissionNames()`).
   */
  private async assertActorCanGrantPermissions(
    actorUserId: string,
    permissionNames: string[],
    context: EscalationDenialContext,
  ): Promise<void> {
    if (permissionNames.length === 0) return;
    const actorPermissions = await this.getUserPermissionNames(actorUserId);
    if (actorPermissions.has('roles.grant_unrestricted')) return;
    const forbidden = permissionNames.filter((n) => !actorPermissions.has(n));
    if (forbidden.length > 0) {
      await this.recordEscalationDenial(actorUserId, context, forbidden);
      throw new ApiException(
        ErrorCode.AUTH_001,
        `مينفعش تمنح صلاحية إنت نفسك ملكهاش: ${forbidden.join(', ')}`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Script 5 Part 4/5 — حدث أمني best-effort عند رفض تصعيد صلاحيات فعلي (الفاعل عنده roles.manage
   * بس بيحاول يمنح/يتجاوز نطاقه هو، أو يمنح لنفسه بالذات). CRITICAL لو الهدف الفاعل نفسه
   * (تصعيد ذاتي حرفي)، وإلا HIGH (تصعيد لمستخدم تاني — لسه خطير بس مش نفس درجة الخطورة).
   */
  private async recordEscalationDenial(
    actorUserId: string,
    context: EscalationDenialContext,
    forbiddenPermissions: string[],
  ): Promise<void> {
    const isSelf = context.targetUserId != null && context.targetUserId === actorUserId;
    await this.securityEvents.recordDenial({
      eventType: isSelf ? SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT : SecurityEventType.UNAUTHORIZED_PERMISSION_GRANT,
      severity: isSelf ? SecurityEventSeverity.CRITICAL : SecurityEventSeverity.HIGH,
      actorUserId,
      targetUserId: context.targetUserId ?? null,
      targetType: context.targetType ?? null,
      action: context.action,
      attemptedValue: { ...(context.attemptedValue ?? {}), forbidden_permissions: forbiddenPermissions },
    });
  }

  /**
   * `is_super_admin` مش موجود كـpermission في `role_permissions` أصلاً (بيتخطى الفحص بالكامل عن
   * طريق تصميم `getUserPermissionNames()`) — يعني فحص "الفاعل عنده كل صلاحيات الدور" العادي
   * مايكفيش لدور `super_admin` نفسه (ممكن يكون عدد صلاحياته المسجّلة فعليًا أقل من كتالوج
   * الصلاحيات الكامل، فالفحص العادي كان هيعدّي غلط). الدور ده بالتحديد يحتاج فحص صريح منفصل.
   */
  private async assertActorIsSuperAdminOrThrow(actorUserId: string, actionAr: string, context: EscalationDenialContext): Promise<void> {
    if (!(await this.isSuperAdminUser(actorUserId))) {
      const isSelf = context.targetUserId != null && context.targetUserId === actorUserId;
      await this.securityEvents.recordDenial({
        eventType: isSelf ? SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT : SecurityEventType.UNAUTHORIZED_ROLE_CHANGE,
        severity: isSelf ? SecurityEventSeverity.CRITICAL : SecurityEventSeverity.HIGH,
        actorUserId,
        targetUserId: context.targetUserId ?? null,
        targetType: context.targetType ?? null,
        action: context.action,
        attemptedValue: context.attemptedValue ?? null,
      });
      throw new ApiException(
        ErrorCode.AUTH_001,
        `لازم تكون Super Admin عشان ${actionAr}`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * بيجمع كل صلاحيات المستخدم من كل أدواره المُعيَّنة — استعلام واحد، مفيش N+1.
   * super_admin (is_super_admin=true) بيتخطى الفحص بالكامل ويرجع كل الكتالوج — يقفل بَقّة
   * "لازم تفتكر تمنح كل صلاحية جديدة لـsuper_admin يدويًا" اللي كانت موجودة من 0020 (ADR-0010 §1).
   *
   * **قاعدة الاشتقاق (تدقيق S-1، ADR-0074): مين بيقدر يعمل أي حاجة على مورد، يقدر يقراه.**
   * أي دور عنده أي صلاحية على مورد بياخد `<resource>.view` بتاعه ضمنيًا. من غير القاعدة دي كان
   * لازم كل دور جديد يتمنح الاتنين بالإيد — ودور جديد بـ`support_tickets.manage` بس كان هيبقى
   * عاجز يفتح شاشة التذاكر أصلاً، فخ صامت بيتكرر مع كل دور. القاعدة على `action = 'view'` بالظبط،
   * مش على أي اسم فيه كلمة view: النطاقات الأضيق زي `technicians.finance.view` (action =
   * `finance_view`) **مش** بتتشتق — مسؤول التوظيف عنده `technicians.approve` ومايصحّش ياخد كشف
   * أرباح الفنيين بالوراثة.
   */
  async getUserPermissionNames(userId: string): Promise<Set<string>> {
    if (await this.isSuperAdminUser(userId)) {
      const all = await this.permissionsRepo.find();
      return new Set(all.map((p) => p.name));
    }
    const rows = await this.dataSource.query<{ name: string }[]>(
      `WITH granted AS (
         SELECT p.name, p.resource
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.is_active = true
         WHERE ur.user_id = $1
       )
       SELECT name FROM granted
       UNION
       SELECT v.name FROM permissions v
       WHERE v.action = 'view' AND v.deleted_at IS NULL
         AND v.resource IN (SELECT resource FROM granted)`,
      [userId],
    );
    return new Set(rows.map((r) => r.name));
  }

  /**
   * صلاحيات القراءة اللي الدور بياخدها ضمنيًا بقاعدة الاشتقاق فوق — مش مخزّنة في
   * `role_permissions`. بترجع منفصلة عن `permission_names` عشان محرّر الأدوار يعرضها كـ«مشتقّة»
   * بدل ما تختفي: لو الواجهة عرضت المخزّن بس، المشغّل هيشوف دور مالوش قراءة وهو فعليًا عنده قراءة.
   */
  private async getRoleImpliedPermissionNames(roleId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ name: string }[]>(
      `WITH granted AS (
         SELECT p.name, p.resource
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
         WHERE rp.role_id = $1
       )
       SELECT v.name FROM permissions v
       WHERE v.action = 'view' AND v.deleted_at IS NULL
         AND v.resource IN (SELECT resource FROM granted)
         AND v.name NOT IN (SELECT name FROM granted)
       ORDER BY v.name ASC`,
      [roleId],
    );
    return rows.map((r) => r.name);
  }

  async hasPermission(userId: string, permissionName: string): Promise<boolean> {
    const permissions = await this.getUserPermissionNames(userId);
    return permissions.has(permissionName);
  }

  // ── الأدوار (Roles) ──────────────────────────────────────────────────

  async listRoles(): Promise<Role[]> {
    return this.roles.find({ order: { name: 'ASC' } });
  }

  async getRoleOrThrow(roleId: string): Promise<Role> {
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (!role) {
      throw new ApiException(ErrorCode.VAL_001, 'الدور غير موجود', HttpStatus.NOT_FOUND);
    }
    return role;
  }

  async getRoleDetail(roleId: string): Promise<RoleDetail> {
    const role = await this.getRoleOrThrow(roleId);
    const permRows = await this.dataSource.query<{ name: string }[]>(
      `SELECT p.name FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
       WHERE rp.role_id = $1 ORDER BY p.name ASC`,
      [roleId],
    );
    const userRows = await this.dataSource.query<
      { user_id: string; full_name: string; phone_number: string; assigned_at: Date }[]
    >(
      `SELECT u.id AS user_id, u.full_name, u.phone_number, ur.assigned_at
       FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL
       WHERE ur.role_id = $1 ORDER BY ur.assigned_at ASC`,
      [roleId],
    );
    return {
      role,
      permission_names: permRows.map((r) => r.name),
      implied_permission_names: await this.getRoleImpliedPermissionNames(roleId),
      users: userRows.map((u) => ({
        user_id: u.user_id,
        full_name: u.full_name,
        phone_number: u.phone_number,
        assigned_at: u.assigned_at.toISOString(),
      })),
    };
  }

  async createRole(actorUserId: string, dto: CreateRoleDto, meta?: AuditActorMeta): Promise<Role> {
    const existing = await this.roles.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'اسم الدور ده مستخدم بالفعل', HttpStatus.CONFLICT);
    }
    // is_system وis_super_admin مش موجودين في CreateRoleDto عمدًا — أدوار جديدة دايمًا false
    // للاتنين (منع تصعيد صلاحيات عبر إنشاء دور واسم مشابه للأدوار النظامية، ADR-0010 §1/§2).
    const role = await this.roles.save(
      this.roles.create({ name: dto.name, displayName: dto.display_name, description: dto.description ?? null }),
    );

    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'role.created',
      entityType: 'role',
      entityId: role.id,
      newValues: { name: role.name, display_name: role.displayName },
      meta,
    });
    return role;
  }

  async updateRole(actorUserId: string, roleId: string, dto: UpdateRoleDto, meta?: AuditActorMeta): Promise<Role> {
    const role = await this.getRoleOrThrow(roleId);
    if (role.isSystem && dto.is_active === false) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تعطّل دور نظامي — الأدوار دي جزء أساسي من تشغيل المنصة', HttpStatus.FORBIDDEN);
    }

    const oldValues = { display_name: role.displayName, description: role.description, is_active: role.isActive };
    if (dto.display_name !== undefined) role.displayName = dto.display_name;
    if (dto.description !== undefined) role.description = dto.description;
    if (dto.is_active !== undefined) role.isActive = dto.is_active;
    await this.roles.save(role);

    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'role.updated',
      entityType: 'role',
      entityId: role.id,
      oldValues,
      newValues: { display_name: role.displayName, description: role.description, is_active: role.isActive },
      meta,
    });
    return role;
  }

  async cloneRole(
    actorUserId: string,
    sourceRoleId: string,
    dto: CreateRoleDto,
    meta?: AuditActorMeta,
  ): Promise<Role> {
    const source = await this.getRoleOrThrow(sourceRoleId);
    // super_admin مش عادي — صلاحياته الفعلية "كل الكتالوج" عن طريق bypass، مش قائمة role_permissions
    // (ممكن تكون أقل من الكتالوج الكامل)، فالفحص العادي تحت مش كافي لمنع نسخه.
    if (source.isSuperAdmin) {
      await this.assertActorIsSuperAdminOrThrow(actorUserId, 'تنسخ دور Super Admin', {
        action: 'roles.clone',
        targetType: 'role',
        attemptedValue: { source_role_id: sourceRoleId, source_role_name: source.name },
      });
    } else {
      const sourcePermissionNames = await this.getRolePermissionNames(sourceRoleId);
      await this.assertActorCanGrantPermissions(actorUserId, sourcePermissionNames, {
        action: 'roles.clone',
        targetType: 'role',
        attemptedValue: { source_role_id: sourceRoleId, source_role_name: source.name },
      });
    }

    const newRole = await this.createRole(actorUserId, dto, meta);

    const sourcePermissionIds = await this.dataSource.query<{ permission_id: string }[]>(
      `SELECT permission_id FROM role_permissions WHERE role_id = $1`,
      [sourceRoleId],
    );
    if (sourcePermissionIds.length > 0) {
      const values = sourcePermissionIds.map((_, i) => `($1, $${i + 2})`).join(', ');
      await this.dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
        [newRole.id, ...sourcePermissionIds.map((r) => r.permission_id)],
      );
    }

    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'role.cloned',
      entityType: 'role',
      entityId: newRole.id,
      oldValues: { source_role_id: source.id, source_role_name: source.name },
      newValues: { name: newRole.name, permissions_copied: sourcePermissionIds.length },
      meta,
    });
    return newRole;
  }

  async deleteRole(actorUserId: string, roleId: string, meta?: AuditActorMeta): Promise<void> {
    const role = await this.getRoleOrThrow(roleId);
    if (role.isSystem) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تحذف دور نظامي — الأدوار دي جزء أساسي من تشغيل المنصة', HttpStatus.FORBIDDEN);
    }
    await this.roles.softDelete(roleId);

    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'role.deleted',
      entityType: 'role',
      entityId: roleId,
      oldValues: { name: role.name, display_name: role.displayName },
      meta,
    });
  }

  /**
   * استبدال كامل لقايمة صلاحيات الدور — منع تصعيد صلاحيات (ADR-0010 §3): الفاعل مينفعش يمنح
   * صلاحية هو نفسه ملوش، إلا لو عنده roles.grant_unrestricted (أو is_super_admin بيتخطاها).
   * قفل صف الدور (pessimistic_write) طول الـtransaction — تعديلين متزامنين على نفس الدور
   * مش هيضيعوا بعض (concurrency-safe، ADR-0010).
   */
  async setRolePermissions(
    actorUserId: string,
    roleId: string,
    permissionNames: string[],
    meta?: AuditActorMeta,
  ): Promise<void> {
    const uniqueNames = Array.from(new Set(permissionNames));

    await this.dataSource.transaction(async (manager) => {
      const role = await manager
        .createQueryBuilder(Role, 'r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id: roleId })
        .getOne();
      if (!role) {
        throw new ApiException(ErrorCode.VAL_001, 'الدور غير موجود', HttpStatus.NOT_FOUND);
      }

      const catalog = await manager.find(Permission);
      const catalogNames = new Set(catalog.map((p) => p.name));
      const unknown = uniqueNames.filter((n) => !catalogNames.has(n));
      if (unknown.length > 0) {
        throw new ApiException(ErrorCode.VAL_001, `صلاحيات غير موجودة في الكتالوج: ${unknown.join(', ')}`, HttpStatus.BAD_REQUEST);
      }

      const currentRows = await manager.query<{ name: string }[]>(
        `SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
        [roleId],
      );
      const currentNames = new Set(currentRows.map((r) => r.name));
      const newlyAdded = uniqueNames.filter((n) => !currentNames.has(n));

      if (newlyAdded.length > 0) {
        const actorPermissions = await this.getUserPermissionNames(actorUserId);
        const actorCanGrantAny = actorPermissions.has('roles.grant_unrestricted');
        if (!actorCanGrantAny) {
          const forbidden = newlyAdded.filter((n) => !actorPermissions.has(n));
          if (forbidden.length > 0) {
            await this.securityEvents.recordDenial({
              eventType: SecurityEventType.UNAUTHORIZED_PERMISSION_GRANT,
              severity: SecurityEventSeverity.HIGH,
              actorUserId,
              targetType: 'role',
              targetId: roleId,
              action: 'roles.set_permissions',
              attemptedValue: { forbidden_permissions: forbidden },
            });
            throw new ApiException(
              ErrorCode.AUTH_001,
              `مينفعش تمنح صلاحية إنت نفسك ملكهاش: ${forbidden.join(', ')}`,
              HttpStatus.FORBIDDEN,
            );
          }
        }
      }

      await manager.delete(RolePermission, { roleId });
      if (uniqueNames.length > 0) {
        const idsByName = new Map(catalog.filter((p) => uniqueNames.includes(p.name)).map((p) => [p.name, p.id]));
        const values = uniqueNames.map((_, i) => `($1, $${i + 2})`).join(', ');
        await manager.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
          [roleId, ...uniqueNames.map((n) => idsByName.get(n))],
        );
      }

      await this.auditLog.record({
        actorUserId,
        actorRole: 'admin',
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: roleId,
        oldValues: { permission_names: Array.from(currentNames) },
        newValues: { permission_names: uniqueNames },
        meta,
      });
    });
  }

  // ── كتالوج الصلاحيات ─────────────────────────────────────────────────

  async listPermissions(): Promise<Permission[]> {
    return this.permissionsRepo.find({ order: { resource: 'ASC', name: 'ASC' } });
  }

  // ── تعيين/سحب دور من مستخدم ──────────────────────────────────────────

  async listUserRoles(userId: string): Promise<RoleAssignment[]> {
    const rows = await this.dataSource.query<
      { role_id: string; role_name: string; display_name: string; assigned_at: Date }[]
    >(
      `SELECT r.id AS role_id, r.name AS role_name, r.display_name, ur.assigned_at
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       WHERE ur.user_id = $1 ORDER BY ur.assigned_at ASC`,
      [userId],
    );
    return rows.map((r) => ({
      role_id: r.role_id,
      role_name: r.role_name,
      display_name: r.display_name,
      assigned_at: r.assigned_at.toISOString(),
    }));
  }

  async assignRole(assignedByUserId: string, userId: string, roleName: string, meta?: AuditActorMeta): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || user.userType !== UserType.ADMIN) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم ده مش حساب أدمن', HttpStatus.BAD_REQUEST);
    }
    const role = await this.roles.findOne({ where: { name: roleName } });
    if (!role) {
      throw new ApiException(ErrorCode.VAL_001, 'الدور غير موجود', HttpStatus.NOT_FOUND);
    }
    if (!role.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الدور ده معطّل حاليًا — مينفعش يتعيّن', HttpStatus.CONFLICT);
    }
    if (role.isSuperAdmin) {
      await this.assertActorIsSuperAdminOrThrow(assignedByUserId, 'تمنح دور Super Admin لمستخدم تاني', {
        action: 'roles.assign',
        targetUserId: userId,
        attemptedValue: { role_name: roleName },
      });
    } else {
      const rolePermissionNames = await this.getRolePermissionNames(role.id);
      await this.assertActorCanGrantPermissions(assignedByUserId, rolePermissionNames, {
        action: 'roles.assign',
        targetUserId: userId,
        attemptedValue: { role_name: roleName },
      });
    }
    const existing = await this.userRoles.findOne({ where: { userId, roleId: role.id } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم عنده الدور ده بالفعل', HttpStatus.CONFLICT);
    }
    await this.userRoles.save(this.userRoles.create({ userId, roleId: role.id, assignedBy: assignedByUserId }));

    // أحسّاس عملية في النظام كله — تغيير صلاحيات مستخدم لازم يتسجّل حرفياً، مش استثناء
    await this.auditLog.record({
      actorUserId: assignedByUserId,
      actorRole: 'admin',
      action: 'role.assigned',
      entityType: 'user',
      entityId: userId,
      newValues: { role_name: roleName },
      meta,
    });
  }

  /** بيتحقق إن المستخدم ده آخر super_admin في النظام — لازم يتنادى قبل أي عملية ممكن تشيل الدور ده منه (سحب دور، حظر حساب). */
  async isLastSuperAdmin(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ user_id: string }[]>(
      `SELECT ur.user_id
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.name = $1 AND r.deleted_at IS NULL`,
      [SUPER_ADMIN_ROLE_NAME],
    );
    return rows.length === 1 && rows[0].user_id === userId;
  }

  async revokeRole(revokedByUserId: string, userId: string, roleName: string, meta?: AuditActorMeta): Promise<void> {
    const role = await this.roles.findOne({ where: { name: roleName } });
    if (!role) {
      throw new ApiException(ErrorCode.VAL_001, 'الدور غير موجود', HttpStatus.NOT_FOUND);
    }
    if (roleName === SUPER_ADMIN_ROLE_NAME) {
      if (await this.isLastSuperAdmin(userId)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'مينفعش تسحب دور super_admin من آخر حساب عنده — النظام هيتقفل تماماً',
          HttpStatus.CONFLICT,
        );
      }
      // بَقّة أمنية اتصلحت (P0-1): سحب دور super_admin من حساب تاني كان مسموح لأي أدمن عنده
      // roles.manage بس — أدمن مش super_admin كان يقدر "يسقط" super_admin تاني من النظام.
      await this.assertActorIsSuperAdminOrThrow(revokedByUserId, 'تسحب دور Super Admin من مستخدم تاني', {
        action: 'roles.revoke',
        targetUserId: userId,
        attemptedValue: { role_name: roleName },
      });
    }
    // حماية القفل الذاتي (ADR-0010 §4) — مختلفة عن فحص آخر super_admin فوق: هنا عن *أي* دور
    // لو ده آخر دور للفاعل نفسه (لا يقدر يفقد وصوله بالكامل بضغطة واحدة).
    if (revokedByUserId === userId) {
      const currentRoles = await this.listUserRoles(userId);
      if (currentRoles.length === 1 && currentRoles[0].role_name === roleName) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'مينفعش تسحب آخر دور من نفسك — هتفقد وصولك للنظام بالكامل',
          HttpStatus.CONFLICT,
        );
      }
    }
    const result = await this.userRoles.delete({ userId, roleId: role.id });
    if (!result.affected) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم مالوش الدور ده أصلاً', HttpStatus.NOT_FOUND);
    }

    await this.auditLog.record({
      actorUserId: revokedByUserId,
      actorRole: 'admin',
      action: 'role.revoked',
      entityType: 'user',
      entityId: userId,
      oldValues: { role_name: roleName },
      meta,
    });
  }
}
