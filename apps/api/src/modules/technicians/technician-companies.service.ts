import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { AddStaffDto } from './dto/add-staff.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { TechnicianCompanyBranch } from './entities/technician-company-branch.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianProfile, TechnicianTeamRole } from './entities/technician-profile.entity';

export interface CompanyDetail {
  company: TechnicianCompany;
  branches: TechnicianCompanyBranch[];
  staff: { profile: TechnicianProfile; user: User }[];
}

const MANAGING_ROLES = new Set<TechnicianTeamRole>([TechnicianTeamRole.OWNER, TechnicianTeamRole.MANAGER]);

@Injectable()
export class TechnicianCompaniesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TechnicianCompany) private readonly companies: Repository<TechnicianCompany>,
    @InjectRepository(TechnicianCompanyBranch) private readonly branches: Repository<TechnicianCompanyBranch>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auditLog: AuditLogService,
  ) {}

  private async findProfileOrThrow(userId: string): Promise<TechnicianProfile> {
    const profile = await this.technicianProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.TECH_001, 'حسابك غير معتمد بعد', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  private async findCompanyOrThrow(companyId: string): Promise<TechnicianCompany> {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) {
      throw new ApiException(ErrorCode.VAL_001, 'الشركة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return company;
  }

  /** بيرجّع بروفايل المستخدم لو عضو (أي دور) في شركة، وإلا بيرمي — دخول أساسي لكل مسارات الشركة */
  private async requireMembership(userId: string): Promise<TechnicianProfile> {
    const profile = await this.findProfileOrThrow(userId);
    if (!profile.companyId) {
      throw new ApiException(ErrorCode.VAL_001, 'مش عضو في أي شركة/فريق', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  /** owner/manager بس يقدروا يديروا الشركة (فروع، أعضاء) — worker/supervisor يشوفوا بس */
  private async requireManager(userId: string): Promise<TechnicianProfile> {
    const profile = await this.requireMembership(userId);
    if (!MANAGING_ROLES.has(profile.teamRole)) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم تكون مالك أو مدير الشركة عشان تعمل العملية دي', HttpStatus.FORBIDDEN);
    }
    return profile;
  }

  async create(userId: string, dto: CreateCompanyDto, meta?: AuditActorMeta): Promise<TechnicianCompany> {
    const profile = await this.findProfileOrThrow(userId);
    if (profile.companyId) {
      throw new ApiException(ErrorCode.VAL_001, 'انت عضو في شركة بالفعل — مينفعش تنشئ واحدة تانية', HttpStatus.CONFLICT);
    }

    const company = await this.dataSource.transaction(async (manager) => {
      const company = manager.create(TechnicianCompany, {
        ownerUserId: userId,
        name: dto.name,
        commercialRegistrationNumber: dto.commercial_registration_number ?? null,
        isActive: true,
      });
      await manager.save(company);

      profile.companyId = company.id;
      profile.teamRole = TechnicianTeamRole.OWNER;
      await manager.save(profile);
      return company;
    });

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_company.created',
      entityType: 'technician_company',
      entityId: company.id,
      newValues: { name: company.name },
      meta,
    });
    return company;
  }

  async getDetail(companyId: string): Promise<CompanyDetail> {
    const company = await this.findCompanyOrThrow(companyId);
    const branches = await this.branches.find({ where: { companyId }, order: { createdAt: 'ASC' } });
    const profiles = await this.technicianProfiles.find({ where: { companyId }, order: { createdAt: 'ASC' } });
    const users = profiles.length ? await this.users.find({ where: { id: In(profiles.map((p) => p.userId)) } }) : [];
    const usersById = new Map(users.map((u) => [u.id, u]));

    return {
      company,
      branches,
      staff: profiles.map((profile) => {
        const user = usersById.get(profile.userId);
        if (!user) {
          throw new ApiException(ErrorCode.VAL_001, 'بيانات المستخدم مش متاحة لهذا العضو', HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return { profile, user };
      }),
    };
  }

  async getMine(userId: string): Promise<CompanyDetail> {
    const profile = await this.requireMembership(userId);
    return this.getDetail(profile.companyId!);
  }

  async listForAdmin(): Promise<{ company: TechnicianCompany; branchCount: number; staffCount: number }[]> {
    const companies = await this.companies.find({ order: { createdAt: 'DESC' } });
    if (companies.length === 0) return [];
    const companyIds = companies.map((c) => c.id);
    const branchCounts = await this.branches
      .createQueryBuilder('branch')
      .select('branch.companyId', 'companyId')
      .addSelect('COUNT(*)', 'count')
      .where('branch.companyId IN (:...companyIds)', { companyIds })
      .groupBy('branch.companyId')
      .getRawMany<{ companyId: string; count: string }>();
    const staffCounts = await this.technicianProfiles
      .createQueryBuilder('profile')
      .select('profile.companyId', 'companyId')
      .addSelect('COUNT(*)', 'count')
      .where('profile.companyId IN (:...companyIds)', { companyIds })
      .groupBy('profile.companyId')
      .getRawMany<{ companyId: string; count: string }>();
    const branchCountByCompany = new Map(branchCounts.map((r) => [r.companyId, Number(r.count)]));
    const staffCountByCompany = new Map(staffCounts.map((r) => [r.companyId, Number(r.count)]));

    return companies.map((company) => ({
      company,
      branchCount: branchCountByCompany.get(company.id) ?? 0,
      staffCount: staffCountByCompany.get(company.id) ?? 0,
    }));
  }

  async update(userId: string, dto: UpdateCompanyDto, meta?: AuditActorMeta): Promise<TechnicianCompany> {
    const profile = await this.requireManager(userId);
    const company = await this.findCompanyOrThrow(profile.companyId!);

    const oldValues = { name: company.name, is_active: company.isActive };
    if (dto.name !== undefined) company.name = dto.name;
    if (dto.commercial_registration_number !== undefined) company.commercialRegistrationNumber = dto.commercial_registration_number;
    if (dto.is_active !== undefined) company.isActive = dto.is_active;
    await this.companies.save(company);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_company.updated',
      entityType: 'technician_company',
      entityId: company.id,
      oldValues,
      newValues: { name: company.name, is_active: company.isActive },
      meta,
    });
    return company;
  }

  async createBranch(userId: string, dto: CreateBranchDto, meta?: AuditActorMeta): Promise<TechnicianCompanyBranch> {
    const profile = await this.requireManager(userId);
    const branch = this.branches.create({
      companyId: profile.companyId!,
      name: dto.name,
      areaId: dto.area_id ?? null,
      addressLine: dto.address_line ?? null,
      isActive: true,
    });
    await this.branches.save(branch);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_company_branch.created',
      entityType: 'technician_company_branch',
      entityId: branch.id,
      newValues: { name: branch.name, company_id: branch.companyId },
      meta,
    });
    return branch;
  }

  private async findOwnBranchOrThrow(companyId: string, branchId: string): Promise<TechnicianCompanyBranch> {
    const branch = await this.branches.findOne({ where: { id: branchId } });
    if (!branch || branch.companyId !== companyId) {
      throw new ApiException(ErrorCode.VAL_001, 'الفرع غير موجود في شركتك', HttpStatus.NOT_FOUND);
    }
    return branch;
  }

  async updateBranch(userId: string, branchId: string, dto: UpdateBranchDto, meta?: AuditActorMeta): Promise<TechnicianCompanyBranch> {
    const profile = await this.requireManager(userId);
    const branch = await this.findOwnBranchOrThrow(profile.companyId!, branchId);

    const oldValues = { name: branch.name, is_active: branch.isActive };
    if (dto.name !== undefined) branch.name = dto.name;
    if (dto.area_id !== undefined) branch.areaId = dto.area_id;
    if (dto.address_line !== undefined) branch.addressLine = dto.address_line;
    if (dto.is_active !== undefined) branch.isActive = dto.is_active;
    await this.branches.save(branch);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_company_branch.updated',
      entityType: 'technician_company_branch',
      entityId: branch.id,
      oldValues,
      newValues: { name: branch.name, is_active: branch.isActive },
      meta,
    });
    return branch;
  }

  private async attachUser(profile: TechnicianProfile): Promise<{ profile: TechnicianProfile; user: User }> {
    const user = await this.users.findOne({ where: { id: profile.userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'بيانات المستخدم مش متاحة لهذا العضو', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return { profile, user };
  }

  async addStaff(userId: string, dto: AddStaffDto, meta?: AuditActorMeta): Promise<{ profile: TechnicianProfile; user: User }> {
    const managerProfile = await this.requireManager(userId);
    const target = await this.technicianProfiles.findOne({ where: { technicianCode: dto.technician_code } });
    if (!target) {
      throw new ApiException(ErrorCode.VAL_001, 'مفيش فني بالكود ده', HttpStatus.NOT_FOUND);
    }
    if (target.userId === userId) {
      throw new ApiException(ErrorCode.VAL_001, 'انت أصلاً مالك الشركة دي', HttpStatus.BAD_REQUEST);
    }
    if (target.companyId) {
      throw new ApiException(
        ErrorCode.VAL_001,
        target.companyId === managerProfile.companyId ? 'الفني ده عضو في شركتك بالفعل' : 'الفني ده عضو في شركة تانية بالفعل',
        HttpStatus.CONFLICT,
      );
    }
    if (dto.branch_id) {
      await this.findOwnBranchOrThrow(managerProfile.companyId!, dto.branch_id);
    }

    target.companyId = managerProfile.companyId!;
    target.branchId = dto.branch_id ?? null;
    target.teamRole = dto.team_role as TechnicianTeamRole;
    await this.technicianProfiles.save(target);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_company_staff.added',
      entityType: 'technician_company',
      entityId: managerProfile.companyId!,
      newValues: { technician_user_id: target.userId, team_role: target.teamRole },
      meta,
    });
    return this.attachUser(target);
  }

  private async findOwnStaffOrThrow(companyId: string, targetUserId: string): Promise<TechnicianProfile> {
    const target = await this.technicianProfiles.findOne({ where: { userId: targetUserId } });
    if (!target || target.companyId !== companyId) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مش عضو في شركتك', HttpStatus.NOT_FOUND);
    }
    if (target.teamRole === TechnicianTeamRole.OWNER) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تعدّل مالك الشركة من هنا', HttpStatus.FORBIDDEN);
    }
    return target;
  }

  async updateStaff(
    userId: string,
    targetUserId: string,
    dto: UpdateStaffDto,
    meta?: AuditActorMeta,
  ): Promise<{ profile: TechnicianProfile; user: User }> {
    const managerProfile = await this.requireManager(userId);
    const target = await this.findOwnStaffOrThrow(managerProfile.companyId!, targetUserId);

    if (dto.branch_id) {
      await this.findOwnBranchOrThrow(managerProfile.companyId!, dto.branch_id);
    }

    const oldValues = { team_role: target.teamRole, branch_id: target.branchId };
    if (dto.team_role !== undefined) target.teamRole = dto.team_role as TechnicianTeamRole;
    if (dto.branch_id !== undefined) target.branchId = dto.branch_id;
    await this.technicianProfiles.save(target);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_company_staff.updated',
      entityType: 'technician_company',
      entityId: managerProfile.companyId!,
      oldValues,
      newValues: { team_role: target.teamRole, branch_id: target.branchId },
      meta,
    });
    return this.attachUser(target);
  }

  async removeStaff(userId: string, targetUserId: string, meta?: AuditActorMeta): Promise<void> {
    const managerProfile = await this.requireManager(userId);
    const target = await this.findOwnStaffOrThrow(managerProfile.companyId!, targetUserId);

    target.companyId = null;
    target.branchId = null;
    target.teamRole = TechnicianTeamRole.INDEPENDENT;
    await this.technicianProfiles.save(target);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_company_staff.removed',
      entityType: 'technician_company',
      entityId: managerProfile.companyId!,
      oldValues: { technician_user_id: target.userId },
      meta,
    });
  }
}
