import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { toRoutingRuleResponseDto } from './dto/routing-rule-response.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';
import { NotificationRoutingService } from './notification-routing.service';

// توجيه الإشعارات الداخلية حسب الدور — أي حدث محتاج فعل إداري يوصل للدور الصح بدون تعديل كود.
@Controller('admin/notification-routing-rules')
@Roles(UserType.ADMIN)
export class AdminNotificationRoutingController {
  constructor(private readonly routingService: NotificationRoutingService) {}

  @Get()
  async list() {
    return (await this.routingService.list()).map(toRoutingRuleResponseDto);
  }

  @Post()
  @RequirePermission('notifications.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: CreateRoutingRuleDto, @AuditContext() audit: AuditMeta) {
    return toRoutingRuleResponseDto(await this.routingService.create(admin.sub, dto, audit));
  }

  @Patch(':id')
  @RequirePermission('notifications.manage')
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoutingRuleDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toRoutingRuleResponseDto(await this.routingService.update(admin.sub, id, dto, audit));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('notifications.manage')
  async delete(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @AuditContext() audit: AuditMeta) {
    await this.routingService.delete(admin.sub, id, audit);
    return null;
  }
}
