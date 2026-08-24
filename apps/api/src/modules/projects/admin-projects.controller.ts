import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
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
  async list() {
    return this.projectsService.listAll();
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
  ) {
    return this.projectsService.transition(admin.sub, id, dto.to as never, dto.reason);
  }

  @Post(':id/quotes')
  @RequirePermission('projects.manage')
  async createQuote(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.projectsService.createQuote(admin.sub, id, dto as never);
  }

  @Post(':id/quotes/:quoteId/send')
  @RequirePermission('projects.manage')
  async sendQuote(@Param('id', ParseUUIDPipe) projectId: string, @Param('quoteId', ParseUUIDPipe) quoteId: string) {
    return this.projectsService.sendQuote(projectId, quoteId, 14);
  }

  @Post(':id/milestones')
  @RequirePermission('projects.manage')
  async createMilestones(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { milestones: unknown[] }) {
    return this.projectsService.createMilestones(id, id, dto.milestones as never);
  }
}
