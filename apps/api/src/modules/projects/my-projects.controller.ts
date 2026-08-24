import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { ProjectsService } from './projects.service';

@Controller('me/projects')
@Roles(UserType.CUSTOMER)
export class MyProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: {
    project_type: string; name_ar: string; description_ar?: string;
    address_id: string; budget_estimate_cents?: number;
  }) {
    return this.projectsService.create(user.sub, dto);
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.projectsService.listForCustomer(user.sub);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.findOne(id);
  }

  @Get(':id/quotes')
  async quotes(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.listQuotesForProject(id);
  }

  @Post(':id/quotes/:quoteId/approve')
  async approveQuote(
    @CurrentUser() user: JwtPayload,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ) {
    return this.projectsService.approveQuote(user.sub, quoteId);
  }
}
