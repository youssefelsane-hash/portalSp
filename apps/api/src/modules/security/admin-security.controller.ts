import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddSecurityEventNoteDto } from './dto/add-security-event-note.dto';
import { ListSecurityEventsQueryDto } from './dto/list-security-events-query.dto';
import { ResolveSecurityEventDto } from './dto/resolve-security-event.dto';
import { SecurityEventsService } from './security-events.service';

// Security Center backend (Script 5 Part 11) — security.alerts.view (قراءة) / security.alerts.manage
// (acknowledge/investigate/resolve/note). صلاحيات جديدة، migration 0137، نفس نمط X.view/X.manage
// الموجود في باقي المشروع.
@Controller('admin/security')
@Roles(UserType.ADMIN)
export class AdminSecurityController {
  constructor(private readonly securityEvents: SecurityEventsService) {}

  @Get('events')
  @RequirePermission('security.alerts.view')
  list(@Query() query: ListSecurityEventsQueryDto) {
    return this.securityEvents.list(query);
  }

  @Get('overview')
  @RequirePermission('security.alerts.view')
  async overview() {
    const bySeverity = await this.securityEvents.countOpenBySeverity();
    return { open_by_severity: bySeverity };
  }

  @Get('events/:id')
  @RequirePermission('security.alerts.view')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.securityEvents.getOrThrow(id);
  }

  @Get('events/:id/notes')
  @RequirePermission('security.alerts.view')
  listNotes(@Param('id', ParseUUIDPipe) id: string) {
    return this.securityEvents.listNotes(id);
  }

  @Post('events/:id/notes')
  @RequirePermission('security.alerts.manage')
  addNote(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddSecurityEventNoteDto) {
    return this.securityEvents.addNote(admin.sub, id, dto.note);
  }

  @Post('events/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security.alerts.manage')
  acknowledge(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.securityEvents.acknowledge(admin.sub, id);
  }

  @Post('events/:id/investigate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security.alerts.manage')
  investigate(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.securityEvents.setInvestigating(admin.sub, id);
  }

  @Post('events/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security.alerts.manage')
  resolve(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveSecurityEventDto) {
    return this.securityEvents.resolve(admin.sub, id, dto.status, dto.resolution_note);
  }
}
