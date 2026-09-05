import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AssignSupportTicketDto, UpdateSupportTicketStatusDto } from './dto/admin-update-support-ticket.dto';
import { ListSupportTicketsDto } from './dto/list-support-tickets.dto';
import { toSupportTicketResponseDto } from './dto/support-ticket-response.dto';
import { SupportTicketsService } from './support-tickets.service';

@Controller('admin/support-tickets')
@Roles(UserType.ADMIN)
export class AdminSupportTicketsController {
  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  @Get()
  @RequirePermission('support_tickets.view')
  async listAll(@Query() query: ListSupportTicketsDto) {
    const tickets = await this.supportTicketsService.listAllForAdmin(query.ticket_status);
    return tickets.map(toSupportTicketResponseDto);
  }

  @Patch(':id/assign')
  @RequirePermission('support_tickets.manage')
  async assign(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSupportTicketDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toSupportTicketResponseDto(await this.supportTicketsService.assign(admin.sub, id, dto, audit));
  }

  @Patch(':id/status')
  @RequirePermission('support_tickets.manage')
  async updateStatus(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketStatusDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toSupportTicketResponseDto(await this.supportTicketsService.updateStatus(admin.sub, id, dto, audit));
  }
}
