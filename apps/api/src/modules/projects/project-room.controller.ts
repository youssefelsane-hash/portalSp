import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { ProjectsService } from './projects.service';

/** endpoint واحد يرجّع كل بيانات المشروع — timeline + quotes + milestones + payments. */
@Controller('me/projects')
@Roles(UserType.CUSTOMER)
export class ProjectRoomController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get(':id/room')
  async projectRoom(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.projectsService.findOneOwned(user.sub, id);
    return this.projectsService.getProjectRoom(id);
  }
}
