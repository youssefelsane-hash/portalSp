import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toNotificationTypeConfigResponseDto } from './dto/notification-type-config-response.dto';
import { UpdateNotificationTypeConfigDto } from './dto/update-notification-type-config.dto';
import { NotificationTypeConfigService } from './notification-type-config.service';

// إعداد الأولوية/الصوت/القناة/actionable لكل notification_type (ADR-0012) — صفر hardcode.
@Controller('admin/notification-type-configs')
@Roles(UserType.ADMIN)
export class AdminNotificationTypeConfigsController {
  constructor(private readonly service: NotificationTypeConfigService) {}

  @Get()
  async list() {
    return (await this.service.list()).map(toNotificationTypeConfigResponseDto);
  }

  @Patch(':notificationType')
  @RequirePermission('notifications.manage')
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('notificationType') notificationType: string,
    @Body() dto: UpdateNotificationTypeConfigDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toNotificationTypeConfigResponseDto(await this.service.update(admin.sub, notificationType, dto, audit));
  }
}
