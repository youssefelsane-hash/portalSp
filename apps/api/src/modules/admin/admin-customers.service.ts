import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { AdminCustomerResponseDto, toAdminCustomerResponseDto } from './dto/customer-response.dto';
import { BlockCustomerDto } from './dto/block-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@Injectable()
export class AdminCustomersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(CustomerProfile) private readonly profiles: Repository<CustomerProfile>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly auditLog: AuditLogService,
  ) {}

  private async findProfileOrThrow(userId: string): Promise<CustomerProfile> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  async list(
    query: ListCustomersQueryDto,
  ): Promise<{ items: AdminCustomerResponseDto[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const qb = this.profiles
      .createQueryBuilder('profile')
      .innerJoinAndMapOne('profile.user', User, 'user', 'user.id = profile.userId');

    if (query.customer_tier) qb.andWhere('profile.customerTier = :tier', { tier: query.customer_tier });
    if (query.is_high_risk !== undefined) qb.andWhere('profile.isHighRisk = :isHighRisk', { isHighRisk: query.is_high_risk });
    if (query.is_blocked !== undefined) qb.andWhere('user.isBlocked = :isBlocked', { isBlocked: query.is_blocked });
    if (query.phone_number) qb.andWhere('user.phoneNumber LIKE :phone', { phone: `%${query.phone_number}%` });

    qb.orderBy('profile.createdAt', 'DESC').skip((page - 1) * perPage).take(perPage);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: (items as (CustomerProfile & { user: User })[]).map((profile) => toAdminCustomerResponseDto(profile, profile.user)),
      meta: { page, per_page: perPage, total },
    };
  }

  async getDetail(userId: string): Promise<AdminCustomerResponseDto> {
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    return toAdminCustomerResponseDto(profile, user);
  }

  async block(adminUserId: string, userId: string, dto: BlockCustomerDto, meta?: AuditActorMeta): Promise<AdminCustomerResponseDto> {
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    if (user.isBlocked) {
      throw new ApiException(ErrorCode.VAL_001, 'العميل محظور بالفعل', HttpStatus.CONFLICT);
    }

    await this.dataSource.transaction(async (manager) => {
      user.isBlocked = true;
      user.blockedReason = dto.reason;
      user.blockedAt = new Date();
      await manager.save(user);

      // العملاء (عكس الموظفين) مالهمش أدوار RBAC (roles/UserRole) — الحظر هنا بيسحب بس
      // جلسات الدخول النشطة، مش صلاحيات مش موجودة أصلاً.
      await manager.update(
        RefreshToken,
        { userId, isRevoked: false },
        { isRevoked: true, revokedAt: new Date(), revokedReason: 'admin_block' },
      );
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'customer.blocked',
      entityType: 'user',
      entityId: userId,
      newValues: { reason: dto.reason },
      meta,
    });

    return toAdminCustomerResponseDto(profile, user);
  }

  async unblock(adminUserId: string, userId: string, meta?: AuditActorMeta): Promise<AdminCustomerResponseDto> {
    const profile = await this.findProfileOrThrow(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'العميل غير موجود', HttpStatus.NOT_FOUND);
    }

    user.isBlocked = false;
    user.blockedReason = null;
    user.blockedAt = null;
    await this.users.save(user);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'customer.unblocked',
      entityType: 'user',
      entityId: userId,
      meta,
    });

    return toAdminCustomerResponseDto(profile, user);
  }
}
