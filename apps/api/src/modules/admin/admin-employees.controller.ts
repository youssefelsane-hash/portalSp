import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminEmployeesService } from './admin-employees.service';
import { BlockEmployeeDto } from './dto/block-employee.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

// إدارة الموظفين/الأدمن (هيكل تنظيمي: قسم، مدير مباشر) — محتاجة employees.manage لأي تعديل،
// القراءة مفتوحة لأي أدمن زي باقي كنترولرز الإدارة (RolesGuard كفاية للـ GET).
@Controller('admin/employees')
@Roles(UserType.ADMIN)
export class AdminEmployeesController {
  constructor(private readonly employeesService: AdminEmployeesService) {}

  @Post()
  @RequirePermission('employees.manage')
  create(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreateEmployeeDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.employeesService.create(admin.sub, dto, audit);
  }

  @Get()
  @RequirePermission('employees.view')
  list(@Query() query: ListEmployeesQueryDto) {
    return this.employeesService.list(query);
  }

  @Get(':userId')
  @RequirePermission('employees.view')
  getDetail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.employeesService.getDetail(userId);
  }

  @Patch(':userId')
  @RequirePermission('employees.manage')
  update(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateEmployeeDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.employeesService.update(admin.sub, userId, dto, audit);
  }

  @Post(':userId/block')
  @RequirePermission('employees.manage')
  block(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: BlockEmployeeDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.employeesService.block(admin.sub, userId, dto, audit);
  }

  @Post(':userId/unblock')
  @RequirePermission('employees.manage')
  unblock(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.employeesService.unblock(admin.sub, userId, audit);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('employees.manage')
  delete(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.employeesService.delete(admin.sub, userId, audit);
  }
}
