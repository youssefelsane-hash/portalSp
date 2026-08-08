import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddStaffDto } from './dto/add-staff.dto';
import {
  toBranchResponseDto,
  toCompanyResponseDto,
  toStaffMemberResponseDto,
  CompanyDetailResponseDto,
} from './dto/company-response.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { CompanyDetail, TechnicianCompaniesService } from './technician-companies.service';

function toDetailResponseDto(detail: CompanyDetail): CompanyDetailResponseDto {
  return {
    company: toCompanyResponseDto(detail.company),
    branches: detail.branches.map(toBranchResponseDto),
    staff: detail.staff.map(({ profile, user }) => toStaffMemberResponseDto(profile, user.fullName)),
  };
}

// شركات/فرق الفنيين — ذاتية الإدارة: الفني اللي بينشئ الشركة بيبقى owner، وهو أو أي manager
// بعد كده يقدر يدير الفروع والأعضاء. مفيش دور admin هنا عمداً — إشراف الأدمن read-only
// في admin-technician-companies.controller.ts.
@Controller('technician/company')
@Roles(UserType.TECHNICIAN)
export class TechnicianCompaniesController {
  constructor(private readonly companiesService: TechnicianCompaniesService) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCompanyDto, @AuditContext() audit: AuditMeta) {
    const company = await this.companiesService.create(user.sub, dto, audit);
    return toCompanyResponseDto(company);
  }

  @Get()
  async getMine(@CurrentUser() user: JwtPayload) {
    return toDetailResponseDto(await this.companiesService.getMine(user.sub));
  }

  @Patch()
  async update(@CurrentUser() user: JwtPayload, @Body() dto: UpdateCompanyDto, @AuditContext() audit: AuditMeta) {
    return toCompanyResponseDto(await this.companiesService.update(user.sub, dto, audit));
  }

  @Post('branches')
  async createBranch(@CurrentUser() user: JwtPayload, @Body() dto: CreateBranchDto, @AuditContext() audit: AuditMeta) {
    return toBranchResponseDto(await this.companiesService.createBranch(user.sub, dto, audit));
  }

  @Patch('branches/:branchId')
  async updateBranch(
    @CurrentUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toBranchResponseDto(await this.companiesService.updateBranch(user.sub, branchId, dto, audit));
  }

  @Post('staff')
  async addStaff(@CurrentUser() user: JwtPayload, @Body() dto: AddStaffDto, @AuditContext() audit: AuditMeta) {
    const { profile, user: targetUser } = await this.companiesService.addStaff(user.sub, dto, audit);
    return toStaffMemberResponseDto(profile, targetUser.fullName);
  }

  @Patch('staff/:userId')
  async updateStaff(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateStaffDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user: targetUser } = await this.companiesService.updateStaff(user.sub, targetUserId, dto, audit);
    return toStaffMemberResponseDto(profile, targetUser.fullName);
  }

  @Delete('staff/:userId')
  @HttpCode(HttpStatus.OK)
  async removeStaff(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.companiesService.removeStaff(user.sub, targetUserId, audit);
    return null;
  }

  // كانت فجوة موثّقة صراحة ("نقل الملكية خارج النطاق دلوقتي") — المالك بس (مش manager) يقدر يستخدمها.
  @Post('transfer-ownership')
  @HttpCode(HttpStatus.OK)
  async transferOwnership(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TransferOwnershipDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user: targetUser } = await this.companiesService.transferOwnership(user.sub, dto, audit);
    return toStaffMemberResponseDto(profile, targetUser.fullName);
  }
}
