import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { toAuditLogResponseDto } from '../audit/dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from '../audit/dto/list-audit-logs-query.dto';

// audit.view مقصورة على super_admin بالبذر الحالي (0021_audit_view_permission.sql) —
// "Super Admin يشاهد Audit Logs كاملة" تحديداً، مش أي أدمن.
@Controller('admin/audit-logs')
@Roles(UserType.ADMIN)
@RequirePermission('audit.view')
export class AdminAuditController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async list(@Query() query: ListAuditLogsQueryDto) {
    const { items, meta } = await this.auditLogService.list(query);
    return { items: items.map(toAuditLogResponseDto), meta };
  }
}
