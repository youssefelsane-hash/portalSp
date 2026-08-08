import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { User, UserType } from '../auth/entities/user.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';

export interface RoleAssignment {
  role_id: string;
  role_name: string;
  display_name: string;
  assigned_at: string;
}

const SUPER_ADMIN_ROLE_NAME = 'super_admin';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auditLog: AuditLogService,
  ) {}

  /** بيجمع كل صلاحيات المستخدم من كل أدواره المُعيَّنة — استعلام واحد، مفيش N+1. */
  async getUserPermissionNames(userId: string): Promise<Set<string>> {
    const rows = await this.dataSource.query<{ name: string }[]>(
      `SELECT DISTINCT p.name
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       WHERE ur.user_id = $1`,
      [userId],
    );
    return new Set(rows.map((r) => r.name));
  }

  async hasPermission(userId: string, permissionName: string): Promise<boolean> {
    const permissions = await this.getUserPermissionNames(userId);
    return permissions.has(permissionName);
  }

  async listRoles(): Promise<Role[]> {
    return this.roles.find({ order: { name: 'ASC' } });
  }

  async listUserRoles(userId: string): Promise<RoleAssignment[]> {
    const rows = await this.dataSource.query<
      { role_id: string; role_name: string; display_name: string; assigned_at: Date }[]
    >(
      `SELECT r.id AS role_id, r.name AS role_name, r.display_name, ur.assigned_at
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
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
    if (roleName === SUPER_ADMIN_ROLE_NAME && (await this.isLastSuperAdmin(userId))) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مينفعش تسحب دور super_admin من آخر حساب عنده — النظام هيتقفل تماماً',
        HttpStatus.CONFLICT,
      );
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
