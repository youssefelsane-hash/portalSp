import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PermissionsService } from './permissions.service';

// باني الأدوار الديناميكي (ADR-0010) — نفس فلسفة PermissionsGuard: القراءة مفتوحة لأي أدمن
// (يشوف كتالوج الصلاحيات وتفاصيل أي دور)، الأفعال المُغيّرة (إنشاء/تعديل/حذف/منح صلاحيات)
// محمية بـ roles.manage الموجودة بالفعل.
@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminRolesController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('permissions')
  listPermissions() {
    return this.permissionsService.listPermissions();
  }

  /**
   * صلاحيات الأدمن الحالي الفعلية — P0-3 (مراجعة أمان شاملة 2026-08-13، docs/12): apps/admin
   * كانت واجهته (app-shell.tsx) بتعرض كل عناصر القائمة (~30 صفحة) لأي حساب أدمن بغض النظر عن
   * صلاحياته الفعلية، حتى لو الـbackend هيرفض كل فعل فيها. مفيش endpoint كان بيرجّع الصلاحيات
   * الفعلية للمستخدم الحالي عشان الواجهة تقدر تفلتر بناءً عليه. مفتوح لأي أدمن (بيرجّع صلاحياته
   * هو بس، مش بيانات حساسة عن حد تاني).
   */
  @Get('me/permissions')
  async getMyPermissions(@CurrentUser() admin: JwtPayload) {
    const names = await this.permissionsService.getUserPermissionNames(admin.sub);
    return { permission_names: Array.from(names).sort() };
  }

  @Get('roles/:id')
  getRoleDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissionsService.getRoleDetail(id);
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  async createRole(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreateRoleDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.permissionsService.createRole(admin.sub, dto, audit);
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  async updateRole(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.permissionsService.updateRole(admin.sub, id, dto, audit);
  }

  @Post('roles/:id/clone')
  @RequirePermission('roles.manage')
  async cloneRole(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRoleDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.permissionsService.cloneRole(admin.sub, id, dto, audit);
  }

  @Delete('roles/:id')
  @RequirePermission('roles.manage')
  async deleteRole(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.permissionsService.deleteRole(admin.sub, id, audit);
    return { id, deleted: true };
  }

  @Put('roles/:id/permissions')
  @RequirePermission('roles.manage')
  async setRolePermissions(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.permissionsService.setRolePermissions(admin.sub, id, dto.permission_names, audit);
    return this.permissionsService.getRoleDetail(id);
  }
}
