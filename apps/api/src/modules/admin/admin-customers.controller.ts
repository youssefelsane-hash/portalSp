import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminCustomersService } from './admin-customers.service';
import { BlockCustomerDto } from './dto/block-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

// إدارة العملاء (عرض بروفايلات/إحصائيات + حظر/فك حظر) — محتاجة customers.manage للحظر،
// القراءة مفتوحة لأي أدمن زي باقي كنترولرز الإدارة (RolesGuard كفاية للـ GET).
@Controller('admin/customers')
@Roles(UserType.ADMIN)
export class AdminCustomersController {
  constructor(private readonly customersService: AdminCustomersService) {}

  @Get()
  list(@Query() query: ListCustomersQueryDto) {
    return this.customersService.list(query);
  }

  @Get(':userId')
  getDetail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.customersService.getDetail(userId);
  }

  @Post(':userId/block')
  @RequirePermission('customers.manage')
  block(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: BlockCustomerDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.customersService.block(admin.sub, userId, dto, audit);
  }

  @Post(':userId/unblock')
  @RequirePermission('customers.manage')
  unblock(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.customersService.unblock(admin.sub, userId, audit);
  }
}
