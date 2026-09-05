import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AssignRoleDto } from './dto/assign-role.dto';
import { PermissionsService } from './permissions.service';

// إدارة الأدوار الإدارية الدقيقة — super_admin بس (roles.manage) يقدر يمنح/يسحب دور من أدمن تاني.
@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminUsersController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('roles')
  @RequirePermission('roles.view')
  listRoles() {
    return this.permissionsService.listRoles();
  }

  @Get('users/:userId/roles')
  @RequirePermission('roles.view')
  listUserRoles(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.permissionsService.listUserRoles(userId);
  }

  @Post('users/:userId/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('roles.manage')
  @RequireStepUp()
  async assignRole(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignRoleDto,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.permissionsService.assignRole(admin.sub, userId, dto.role_name, audit);
    return this.permissionsService.listUserRoles(userId);
  }

  @Delete('users/:userId/roles/:roleName')
  @RequirePermission('roles.manage')
  @RequireStepUp()
  async revokeRole(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleName') roleName: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.permissionsService.revokeRole(admin.sub, userId, roleName, audit);
    return this.permissionsService.listUserRoles(userId);
  }
}
