import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { ProjectsService } from './projects.service';

@Controller('admin/projects')
@Roles(UserType.ADMIN)
export class AdminProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @RequirePermission('projects.view')
  async list(@Query('page') page?: string, @Query('per_page') perPage?: string) {
    return this.projectsService.listAll(Number(page) || 1, Number(perPage) || 20);
  }

  @Get(':id/room')
  @RequirePermission('projects.view')
  async projectRoom(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.getProjectRoom(id);
  }

  @Post(':id/transition')
  @RequirePermission('projects.manage')
  async transition(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { to: string; reason?: string },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.transition(admin.sub, id, dto.to as never, dto.reason, meta);
  }

  @Post(':id/quotes')
  @RequirePermission('projects.manage')
  async createQuote(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.createQuote(admin.sub, id, dto as never, meta);
  }

  @Post(':id/quotes/:quoteId/send')
  @RequirePermission('projects.manage')
  async sendQuote(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.sendQuote(admin.sub, quoteId, 14, projectId, meta);
  }

  @Post(':id/milestones')
  @RequirePermission('projects.manage')
  async createMilestones(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { milestones: unknown[] },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.createMilestones(admin.sub, id, dto.milestones as never, meta);
  }
}
