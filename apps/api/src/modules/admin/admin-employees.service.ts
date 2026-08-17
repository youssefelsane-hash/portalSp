import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User, UserType } from '../auth/entities/user.entity';
import { BlockEmployeeDto } from './dto/block-employee.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { EmployeeResponseDto, toEmployeeResponseDto } from './dto/employee-response.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

export interface EmployeeDetail {
  employee: EmployeeResponseDto;
  roles: { role_id: string; role_name: string; display_name: string; assigned_at: string }[];
  recent_logins: {
    device_name: string | null;
    device_platform: string | null;
    ip_address: string | null;
    created_at: string;
    is_revoked: boolean;
  }[];
  recent_activity: { action: string; entity_type: string; entity_id: string; created_at: string }[];
}

@Injectable()
export class AdminEmployeesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(EmployeeProfile) private readonly profiles: Repository<EmployeeProfile>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly auditLog: AuditLogService,
    private readonly permissionsService: PermissionsService,
  ) {}

  private async nextEmployeeCode(manager: EntityManager): Promise<string> {
    const [{ next_human_readable_number: code }] = await manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('EMP')");
    return code;
  }

  private async findProfileOrThrow(userId: string, manager?: EntityManager): Promise<EmployeeProfile> {
    const repo = manager ? manager.getRepository(EmployeeProfile) : this.profiles;
    const profile = await repo.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'الموظف غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  private async assertManagerIsAdmin(managerUserId: string): Promise<void> {
    const manager = await this.users.findOne({ where: { id: managerUserId } });
    if (!manager || manager.userType !== UserType.ADMIN) {
      throw new ApiException(ErrorCode.VAL_001, 'المدير المباشر لازم يكون حساب أدمن', HttpStatus.BAD_REQUEST);
    }
  }

  async create(createdByUserId: string, dto: CreateEmployeeDto, meta?: AuditActorMeta): Promise<EmployeeResponseDto> {
    const existingUser = await this.users.findOne({ where: { phoneNumber: dto.phone_number } });
    if (existingUser) {
      throw new ApiException(ErrorCode.VAL_001, 'رقم الهاتف ده مسجل بحساب موجود بالفعل', HttpStatus.CONFLICT);
    }
    if (dto.manager_user_id) {
      await this.assertManagerIsAdmin(dto.manager_user_id);
    }

    const { user, profile } = await this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        phoneNumber: dto.phone_number,
        // بيتضاف يدوياً من Super Admin موثوق — بيتحسب متحقق فوراً، عكس تسجيل العميل/الفني الذاتي
        phoneVerifiedAt: new Date(),
        fullName: dto.full_name,
        userType: UserType.ADMIN,
        isActive: true,
        isBlocked: false,
      });
      await manager.save(user);

      const employeeCode = await this.nextEmployeeCode(manager);
      const profile = manager.create(EmployeeProfile, {
        userId: user.id,
        employeeCode,
        department: dto.department,
        title: dto.title ?? null,
        managerUserId: dto.manager_user_id ?? null,
        hireDate: dto.hire_date ?? null,
        isActive: true,
        notes: dto.notes ?? null,
        createdByUserId,
      });
      await manager.save(profile);
      return { user, profile };
    });

    await this.auditLog.record({
      actorUserId: createdByUserId,
      actorRole: 'admin',
      action: 'employee.created',
      entityType: 'user',
      entityId: user.id,
      newValues: { phone_number: user.phoneNumber, full_name: user.fullName, department: profile.department },
      meta,
    });

    // منح دور أول اختياري — مش جوّه نفس معاملة الإنشاء عمداً: فشل منح الدور مايلغيش وجود
    // الحساب نفسه، بالظبط زي إصدار حدث user.registered بعد حفظ العميل في auth.service.
    if (dto.initial_role_name) {
      await this.permissionsService.assignRole(createdByUserId, user.id, dto.initial_role_name, meta);
    }

    return toEmployeeResponseDto(profile, user);
  }

  async list(query: ListEmployeesQueryDto): Promise<{ items: EmployeeResponseDto[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const qb = this.profiles
      .createQueryBuilder('profile')
      .innerJoinAndMapOne('profile.user', User, 'user', 'user.id = profile.userId');

    if (query.department) qb.andWhere('profile.department = :department', { department: query.department });
    if (query.manager_user_id) qb.andWhere('profile.managerUserId = :managerUserId', { managerUserId: query.manager_user_id });
    if (query.is_active !== undefined) qb.andWhere('profile.isActive = :isActive', { isActive: query.is_active });

    qb.orderBy('profile.createdAt', 'DESC').skip((page - 1) * perPage).take(perPage);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: (items as (EmployeeProfile & { user: User })[]).map((profile) => toEmployeeResponseDto(profile, profile.user)),
      meta: { page, per_page: perPage, total },
    };
  }

  async getDetail(userId: string): Promise<EmployeeDetail> {
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'الموظف غير موجود', HttpStatus.NOT_FOUND);
    }

    const roles = await this.permissionsService.listUserRoles(userId);

    const recentLogins = await this.refreshTokens.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const { items: recentActivity } = await this.auditLog.list({ actor_user_id: userId, page: 1, per_page: 20 });

    return {
      employee: toEmployeeResponseDto(profile, user),
      roles,
      recent_logins: recentLogins.map((token) => ({
        device_name: token.deviceName,
        device_platform: token.devicePlatform,
        ip_address: token.ipAddress,
        created_at: token.createdAt.toISOString(),
        is_revoked: token.isRevoked,
      })),
      recent_activity: recentActivity.map((log) => ({
        action: log.action,
        entity_type: log.entityType,
        entity_id: log.entityId,
        created_at: log.createdAt.toISOString(),
      })),
    };
  }

  async update(adminUserId: string, userId: string, dto: UpdateEmployeeDto, meta?: AuditActorMeta): Promise<EmployeeResponseDto> {
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'الموظف غير موجود', HttpStatus.NOT_FOUND);
    }
    if (dto.manager_user_id) {
      if (dto.manager_user_id === userId) {
        throw new ApiException(ErrorCode.VAL_001, 'الموظف مينفعش يكون مديره المباشر نفسه', HttpStatus.BAD_REQUEST);
      }
      await this.assertManagerIsAdmin(dto.manager_user_id);
    }
    if (dto.is_active === false) {
      if (userId === adminUserId) {
        throw new ApiException(ErrorCode.VAL_001, 'مينفعش تعطل حسابك انت', HttpStatus.BAD_REQUEST);
      }
      if (await this.permissionsService.isLastSuperAdmin(userId)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'مينفعش تعطل آخر حساب super_admin في النظام',
          HttpStatus.CONFLICT,
        );
      }
    }

    const oldValues = {
      department: profile.department,
      title: profile.title,
      manager_user_id: profile.managerUserId,
      is_active: profile.isActive,
    };

    await this.dataSource.transaction(async (manager) => {
      if (dto.full_name !== undefined) user.fullName = dto.full_name;
      if (dto.department !== undefined) profile.department = dto.department;
      if (dto.title !== undefined) profile.title = dto.title;
      if (dto.manager_user_id !== undefined) profile.managerUserId = dto.manager_user_id;
      if (dto.hire_date !== undefined) profile.hireDate = dto.hire_date;
      if (dto.notes !== undefined) profile.notes = dto.notes;
      if (dto.is_active !== undefined) {
        profile.isActive = dto.is_active;
        user.isActive = dto.is_active;
      }

      await manager.save(user);
      await manager.save(profile);
      if (dto.is_active === false) {
        await manager.update(
          RefreshToken,
          { userId, isRevoked: false },
          { isRevoked: true, revokedAt: new Date(), revokedReason: 'employee_deactivated' },
        );
      }
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'employee.updated',
      entityType: 'user',
      entityId: userId,
      oldValues,
      newValues: {
        department: profile.department,
        title: profile.title,
        manager_user_id: profile.managerUserId,
        is_active: profile.isActive,
      },
      meta,
    });

    return toEmployeeResponseDto(profile, user);
  }

  async block(adminUserId: string, userId: string, dto: BlockEmployeeDto, meta?: AuditActorMeta): Promise<EmployeeResponseDto> {
    if (userId === adminUserId) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش توقف حسابك انت', HttpStatus.BAD_REQUEST);
    }
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'الموظف غير موجود', HttpStatus.NOT_FOUND);
    }
    // الحظر بيسحب كل أدوار الموظف (تحت) — لو ده آخر super_admin، النتيجة قفل كامل للنظام
    if (await this.permissionsService.isLastSuperAdmin(userId)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مينفعش توقف آخر حساب super_admin في النظام — النظام هيتقفل تماماً',
        HttpStatus.CONFLICT,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      user.isBlocked = true;
      user.blockedReason = dto.reason;
      user.blockedAt = new Date();
      await manager.save(user);

      // سحب كل الأدوار وإلغاء كل refresh tokens. JwtStrategy وRealtimeAccessService يفحصان
      // حالة users الحية، وmigration 0123 تفصل sockets القائمة فور commit للحظر.
      await manager.delete(UserRole, { userId });
      await manager.update(RefreshToken, { userId, isRevoked: false }, { isRevoked: true, revokedAt: new Date(), revokedReason: 'admin_block' });
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'employee.blocked',
      entityType: 'user',
      entityId: userId,
      newValues: { reason: dto.reason },
      meta,
    });

    return toEmployeeResponseDto(profile, user);
  }

  async unblock(adminUserId: string, userId: string, meta?: AuditActorMeta): Promise<EmployeeResponseDto> {
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'الموظف غير موجود', HttpStatus.NOT_FOUND);
    }

    user.isBlocked = false;
    user.blockedReason = null;
    user.blockedAt = null;
    await this.users.save(user);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'employee.unblocked',
      entityType: 'user',
      entityId: userId,
      meta,
    });

    return toEmployeeResponseDto(profile, user);
  }

  // كانت فجوة موثّقة (§13.7): مفيش soft-delete حقيقي لحساب موظف — الأداة الوحيدة كانت block
  // (تعطيل قابل للرجوع). ده دائم ومقصود يكون كده (نفس نمط catalog/geo — مفيش restore endpoint)،
  // عكس block اللي ليه unblock. بيتبع نفس نمط AuthService.deleteMe بالظبط: إلغاء التوكنات، تعطيل
  // is_active، بعدين softDelete — بس هنا كمان بيسحب أدوار RBAC (الموظف عنده أدوار، عكس العميل).
  async delete(adminUserId: string, userId: string, meta?: AuditActorMeta): Promise<void> {
    if (userId === adminUserId) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تمسح حسابك انت', HttpStatus.BAD_REQUEST);
    }
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'الموظف غير موجود', HttpStatus.NOT_FOUND);
    }
    if (await this.permissionsService.isLastSuperAdmin(userId)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مينفعش تمسح آخر حساب super_admin في النظام — النظام هيتقفل تماماً',
        HttpStatus.CONFLICT,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserRole, { userId });
      await manager.update(RefreshToken, { userId, isRevoked: false }, { isRevoked: true, revokedAt: new Date(), revokedReason: 'admin_delete' });
      await manager.update(User, { id: userId }, { isActive: false });
      await manager.softDelete(EmployeeProfile, { id: profile.id });
      await manager.softDelete(User, { id: userId });
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'employee.deleted',
      entityType: 'user',
      entityId: userId,
      oldValues: { phone_number: user.phoneNumber, full_name: user.fullName, employee_code: profile.employeeCode },
      meta,
    });
  }
}
